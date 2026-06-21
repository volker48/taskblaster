import type { CiFailureRouteRequest } from "../router/ciFailureRouter.ts";
import type {
  CiFailureWorker,
  RepairMutationKind,
  RepairMutationPlan,
  RepairMutationResult,
  WorkerOutcome,
} from "./ciFailureWorkers.ts";

const MECHANICAL_FAILURE_PATTERNS = [
  { kind: "format", pattern: /\b(format|formatting|prettier|oxfmt|ruff format)\b/i },
  { kind: "lint", pattern: /\b(lint|linting|eslint|oxlint|ruff check)\b/i },
] as const;

export type BranchMutationRequest = {
  readonly candidate: CiFailureRouteRequest;
  readonly plan: RepairMutationPlan;
  readonly requireTrustedBranch: true;
};

export interface BranchMutationDriver {
  apply(request: BranchMutationRequest): Promise<RepairMutationResult>;
}

export function createCheapRepairMutationWorker(
  branchMutations: BranchMutationDriver,
): CiFailureWorker & { readonly profile: "cheap_ci_worker" } {
  return {
    profile: "cheap_ci_worker",
    async attempt(input) {
      if (input.decision.workerId !== "cheap_ci_worker") {
        return unresolved("Cheap repair worker only handles cheap CI decisions.");
      }

      const plan = planMechanicalRepair(input.request);

      if (!plan) {
        return unresolved("CI failure is not a recognized mechanical repair.");
      }

      const mutation = await branchMutations.apply({
        candidate: input.request,
        plan,
        requireTrustedBranch: true,
      });

      return resolved(mutation);
    },
  };
}

export function planMechanicalRepair(
  request: CiFailureRouteRequest,
): RepairMutationPlan | null {
  const failureKinds = request.input.failures.map((failure) =>
    classifyMechanicalFailure(failure.name),
  );
  const mechanicalKinds = failureKinds.filter(
    (kind): kind is RepairMutationKind => kind !== null,
  );

  if (mechanicalKinds.length !== request.input.failures.length) {
    return null;
  }

  return {
    kind: mechanicalKinds.includes("format") ? "format" : "lint",
    delivery: "direct",
    failureNames: request.input.failures.map((failure) => failure.name),
    maxChangedFiles: 20,
  };
}

function classifyMechanicalFailure(name: string): RepairMutationKind | null {
  const match = MECHANICAL_FAILURE_PATTERNS.find(({ pattern }) => pattern.test(name));

  return match?.kind ?? null;
}

function resolved(mutation: RepairMutationResult): WorkerOutcome {
  return {
    status: "resolved",
    summary: `Applied repair mutation to ${mutation.changedFiles.length} file(s).`,
    mutation,
  };
}

function unresolved(summary: string): WorkerOutcome {
  return { status: "unresolved", summary };
}
