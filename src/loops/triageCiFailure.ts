import {
  routeCiFailure,
  type CiFailureRouteRequest,
  type CiFailureRouterModel,
  type WorkerProfile,
} from "../router/ciFailureRouter.ts";
import type { CiFailureWorkerMap, WorkerOutcome } from "../workers/ciFailureWorkers.ts";
import {
  climbEscalationLadder,
  validateCiFailureWorkerMap,
  type ClimbOutcome,
} from "../escalation/ladder.ts";
import {
  buildStackedPullRequestRequest,
  type StackedPullRequestCreator,
  type StackedPullRequestResult,
} from "../providers/github/index.ts";
import {
  TRIAGE_CI_FAILURE_WORKFLOW,
  type TriageCiFailureCandidate,
  type Workflow,
} from "../domain/index.ts";
import { DEFAULT_MUTATION_CAP } from "../runtimeTargets.ts";

export type TriageCiFailureResult =
  | { status: "no_candidate"; reason: string }
  | {
      status: "resolved";
      worker: WorkerProfile;
      outcome: Extract<WorkerOutcome, { status: "resolved" }>;
      stackedPullRequest?: StackedPullRequestResult;
    }
  | {
      status: "escalated";
      worker: WorkerProfile;
      outcome: WorkerOutcome;
      attemptedWorkers: readonly WorkerProfile[];
      reason: string;
    };

export type TriageCiFailureDependencies = {
  routerModel: CiFailureRouterModel;
  workers: CiFailureWorkerMap;
  stackedPullRequests?: StackedPullRequestCreator;
  humanEscalationPublisher?: HumanEscalationPublisher;
};

export type HumanEscalationOutput = {
  readonly candidate: TriageCiFailureCandidate;
  readonly attemptedWorkers: readonly WorkerProfile[];
  readonly failureSummary: string;
  readonly recommendedAction: string;
};

export interface HumanEscalationPublisher {
  publish(output: HumanEscalationOutput): Promise<void>;
}

export type ProviderResolvedOutput = {
  readonly candidate: TriageCiFailureCandidate;
  readonly result: Extract<TriageCiFailureResult, { status: "resolved" }>;
};

export interface ProviderActivityPublisher {
  publishAccepted(candidate: TriageCiFailureCandidate): Promise<void>;
  publishResolved(output: ProviderResolvedOutput): Promise<void>;
}

export type TriageCiFailureLoopDependencies = {
  routerModel: CiFailureRouterModel;
  workers: Parameters<typeof validateCiFailureWorkerMap>[0];
  mutationCap?: MutationCap;
  stackedPullRequests?: StackedPullRequestCreator;
  humanEscalationPublisher?: HumanEscalationPublisher;
  providerActivityPublisher?: ProviderActivityPublisher;
};

export type TriageCiFailureLoopResult =
  | {
      status: "no_candidate";
      workflowName: typeof TRIAGE_CI_FAILURE_WORKFLOW;
      reason: string;
    }
  | {
      status: "failed";
      workflowName: typeof TRIAGE_CI_FAILURE_WORKFLOW;
      reason: string;
    }
  | {
      status: "capped";
      workflowName: typeof TRIAGE_CI_FAILURE_WORKFLOW;
      candidate: TriageCiFailureCandidate;
      reason: string;
      mutationCap: MutationCapSnapshot;
    }
  | {
      status: "completed";
      workflowName: typeof TRIAGE_CI_FAILURE_WORKFLOW;
      candidate: TriageCiFailureCandidate;
      result: TriageCiFailureResult;
    };

export type MutationCap = {
  readonly limit: number;
  readonly active: number;
};

export type MutationCapSnapshot = MutationCap & {
  readonly available: number;
};

export class TriageCiFailureWorkflow implements Workflow<
  TriageCiFailureCandidate,
  TriageCiFailureResult
> {
  readonly name = TRIAGE_CI_FAILURE_WORKFLOW;

  constructor(private readonly dependencies: TriageCiFailureDependencies) {}

  run(input: TriageCiFailureCandidate): Promise<TriageCiFailureResult> {
    return triageCiFailureWorkflow(input, this.dependencies);
  }
}

export async function runTriageCiFailureLoop(
  candidates: readonly TriageCiFailureCandidate[],
  dependencies: TriageCiFailureLoopDependencies,
): Promise<readonly TriageCiFailureLoopResult[]> {
  if (candidates.length === 0) {
    return [
      {
        status: "no_candidate",
        workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
        reason: "No accepted CI failure candidates to run.",
      },
    ];
  }

  let workers: CiFailureWorkerMap;
  let mutationCap: MutationCapSnapshot | null;

  try {
    workers = validateCiFailureWorkerMap(dependencies.workers);
    mutationCap = normalizeMutationCap(dependencies.mutationCap);
  } catch (error) {
    return [
      {
        status: "failed",
        workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
        reason: configurationFailureReason(error),
      },
    ];
  }

  const workflow = new TriageCiFailureWorkflow({
    routerModel: dependencies.routerModel,
    workers,
    stackedPullRequests: dependencies.stackedPullRequests,
    humanEscalationPublisher: dependencies.humanEscalationPublisher,
  });
  const runnableCandidates = mutationCap ? candidates.slice(0, mutationCap.available) : candidates;
  const cappedResults = mutationCap
    ? candidates
        .slice(mutationCap.available)
        .map((candidate) => mutationCappedResult(candidate, mutationCap))
    : [];

  const completedResults: readonly TriageCiFailureLoopResult[] = await Promise.all(
    runnableCandidates.map((candidate) =>
      runAcceptedCandidate(candidate, workflow, dependencies.providerActivityPublisher),
    ),
  );

  return [...completedResults, ...cappedResults];
}

async function runAcceptedCandidate(
  candidate: TriageCiFailureCandidate,
  workflow: TriageCiFailureWorkflow,
  providerActivityPublisher: ProviderActivityPublisher | undefined,
): Promise<TriageCiFailureLoopResult> {
  await providerActivityPublisher?.publishAccepted(candidate);

  const result = await workflow.run(candidate);

  if (result.status === "resolved") {
    await providerActivityPublisher?.publishResolved({ candidate, result });
  }

  return {
    status: "completed",
    workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
    candidate,
    result,
  };
}

export async function triageCiFailureWorkflow(
  input: TriageCiFailureCandidate,
  dependencies: TriageCiFailureDependencies,
): Promise<TriageCiFailureResult> {
  const workers = validateCiFailureWorkerMap(dependencies.workers);
  const candidate = precheckTriageCiFailure(input);

  if (!candidate) {
    return { status: "no_candidate", reason: "No CI failure candidate to route." };
  }

  const classification = await routeCiFailure(dependencies.routerModel, candidate);
  const climb = await climbEscalationLadder(candidate, classification, workers);
  const result = await finalizeClimb(candidate, climb, dependencies.stackedPullRequests);

  if (result.status === "escalated") {
    await dependencies.humanEscalationPublisher?.publish(
      buildHumanEscalationOutput(candidate, result),
    );
  }

  return result;
}

export function precheckTriageCiFailure(
  input: TriageCiFailureCandidate,
): CiFailureRouteRequest | null {
  if (input.workflowName !== TRIAGE_CI_FAILURE_WORKFLOW) {
    return null;
  }

  if (input.input.failures.length === 0) {
    return null;
  }

  return input.input.changeRequest.headSha.trim() === "" ? null : input;
}

async function finalizeClimb(
  request: CiFailureRouteRequest,
  climb: ClimbOutcome,
  stackedPullRequests?: StackedPullRequestCreator,
): Promise<TriageCiFailureResult> {
  if (climb.status === "escalated") {
    return {
      status: "escalated",
      worker: climb.worker,
      outcome: climb.outcome,
      attemptedWorkers: climb.attemptedWorkers,
      reason: climb.reason,
    };
  }

  return resolveWorkerAttempt(
    request,
    { worker: climb.worker, outcome: climb.outcome },
    stackedPullRequests,
  );
}

async function resolveWorkerAttempt(
  request: CiFailureRouteRequest,
  attempt: {
    worker: WorkerProfile;
    outcome: Extract<WorkerOutcome, { status: "resolved" }>;
  },
  stackedPullRequests?: StackedPullRequestCreator,
): Promise<TriageCiFailureResult> {
  const mutation = attempt.outcome.mutation;

  if (!mutation || !needsStackedPullRequest(attempt.worker, mutation)) {
    return { status: "resolved", ...attempt };
  }

  if (!stackedPullRequests) {
    throw new Error("Missing stacked pull request creator for extensive repair mutation");
  }

  const stackedPullRequest = await stackedPullRequests.createStackedPullRequest(
    buildStackedPullRequestRequest(request, mutation),
  );

  return { status: "resolved", ...attempt, stackedPullRequest };
}

function needsStackedPullRequest(
  worker: WorkerProfile,
  mutation: Extract<WorkerOutcome, { status: "resolved" }>["mutation"],
): boolean {
  if (worker !== "deep_ci_worker" || !mutation) {
    return false;
  }

  return (
    mutation.delivery === "stacked_pr" || mutation.risk === "extensive" || mutation.risk === "risky"
  );
}

function configurationFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return `CI failure loop is misconfigured: ${message}`;
}

function buildHumanEscalationOutput(
  candidate: TriageCiFailureCandidate,
  result: Extract<TriageCiFailureResult, { status: "escalated" }>,
): HumanEscalationOutput {
  return {
    candidate,
    attemptedWorkers: result.attemptedWorkers,
    failureSummary: result.outcome.summary,
    recommendedAction:
      "Review the failed checks and automation summary, then apply a manual fix " +
      "or close the candidate.",
  };
}

function normalizeMutationCap(cap: MutationCap | undefined): MutationCapSnapshot | null {
  const effectiveCap = cap ?? { limit: DEFAULT_MUTATION_CAP, active: 0 };
  const limit = nonNegativeInteger(effectiveCap.limit, "Mutation Cap limit");
  const active = nonNegativeInteger(effectiveCap.active, "active Repair Mutations");

  return {
    limit,
    active,
    available: Math.max(limit - active, 0),
  };
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return value;
}

function mutationCappedResult(
  candidate: TriageCiFailureCandidate,
  mutationCap: MutationCapSnapshot,
): TriageCiFailureLoopResult {
  return {
    status: "capped",
    workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
    candidate,
    reason: "Mutation Cap exhausted; candidate deferred before Repair Mutation.",
    mutationCap,
  };
}
