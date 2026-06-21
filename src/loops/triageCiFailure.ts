import {
  routeCiFailure,
  type CiFailureRouteDecision,
  type CiFailureRouteRequest,
  type CiFailureRouterModel,
  type WorkerProfile,
} from "../router/ciFailureRouter";
import {
  nextEscalation,
  validateCiFailureWorkerMap,
  type CiFailureWorkerMap,
  type WorkerOutcome,
} from "../workers/ciFailureWorkers";
import {
  TRIAGE_CI_FAILURE_WORKFLOW,
  type Escalation,
  type TriageCiFailureCandidate,
  type Workflow,
} from "../domain";

export type TriageCiFailureResult =
  | { status: "no_candidate"; reason: string }
  | { status: "resolved"; worker: WorkerProfile; outcome: WorkerOutcome }
  | {
      status: "escalated";
      worker: WorkerProfile;
      outcome: WorkerOutcome;
      escalation: Escalation<WorkerProfile>;
    };

export type TriageCiFailureDependencies = {
  routerModel: CiFailureRouterModel;
  workers: CiFailureWorkerMap;
};

export type TriageCiFailureLoopDependencies = {
  routerModel: CiFailureRouterModel;
  workers: Parameters<typeof validateCiFailureWorkerMap>[0];
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
      status: "completed";
      workflowName: typeof TRIAGE_CI_FAILURE_WORKFLOW;
      candidate: TriageCiFailureCandidate;
      result: TriageCiFailureResult;
    };

export class TriageCiFailureWorkflow
  implements Workflow<TriageCiFailureCandidate, TriageCiFailureResult>
{
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

  try {
    workers = validateCiFailureWorkerMap(dependencies.workers);
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
  });

  return Promise.all(
    candidates.map(async (candidate) => ({
      status: "completed" as const,
      workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
      candidate,
      result: await workflow.run(candidate),
    })),
  );
}

export async function triageCiFailureWorkflow(
  input: TriageCiFailureCandidate,
  dependencies: TriageCiFailureDependencies,
): Promise<TriageCiFailureResult> {
  const dependenciesWithValidatedWorkers = {
    ...dependencies,
    workers: validateCiFailureWorkerMap(dependencies.workers),
  };
  const candidate = precheckTriageCiFailure(input);

  if (!candidate) {
    return { status: "no_candidate", reason: "No CI failure candidate to route." };
  }

  const decision = await routeCiFailure(dependenciesWithValidatedWorkers.routerModel, candidate);
  return attemptWorkerWithEscalation(
    candidate,
    decision,
    dependenciesWithValidatedWorkers.workers,
  );
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

async function attemptWorkerWithEscalation(
  request: CiFailureRouteRequest,
  decision: CiFailureRouteDecision,
  workers: CiFailureWorkerMap,
): Promise<TriageCiFailureResult> {
  const firstAttempt = await attemptWorker(request, decision, workers);

  if (firstAttempt.outcome.status === "resolved") {
    return {
      status: "resolved",
      worker: firstAttempt.worker,
      outcome: firstAttempt.outcome,
    };
  }

  const escalation = nextEscalation(firstAttempt.worker);

  if (escalation.target === "human") {
    return { status: "escalated", ...firstAttempt, escalation };
  }

  const nextDecision: CiFailureRouteDecision = {
    ...decision,
    difficulty: "deep",
    workerId: escalation.workerId,
  };
  const secondAttempt = await attemptWorker(request, nextDecision, workers);

  if (secondAttempt.outcome.status === "resolved") {
    return {
      status: "resolved",
      worker: secondAttempt.worker,
      outcome: secondAttempt.outcome,
    };
  }

  return {
    status: "escalated",
    ...secondAttempt,
    escalation: nextEscalation(secondAttempt.worker),
  };
}

async function attemptWorker(
  request: CiFailureRouteRequest,
  decision: CiFailureRouteDecision,
  workers: CiFailureWorkerMap,
): Promise<{ worker: WorkerProfile; outcome: WorkerOutcome }> {
  const worker = workers[decision.workerId];
  const outcome = await worker.attempt({ request, decision });

  return { worker: worker.profile, outcome };
}

function configurationFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return `CI failure loop is misconfigured: ${message}`;
}
