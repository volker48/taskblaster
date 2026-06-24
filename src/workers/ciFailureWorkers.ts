import type {
  CiFailureRouteRequest,
  CiFailureRouteDecision,
  WorkerProfile,
} from "../router/ciFailureRouter.ts";
import type { Worker } from "../domain/index.ts";

export type WorkerOutcome =
  | { status: "resolved"; summary: string; mutation?: RepairMutationResult }
  | { status: "unresolved"; summary: string };

export type RepairMutationKind = "format" | "lint" | "correctness";
export type RepairMutationDelivery = "direct" | "stacked_pr";
export type RepairMutationRisk = "low" | "extensive" | "risky";

export type RepairMutationPlan = {
  readonly kind: RepairMutationKind;
  readonly failureNames: readonly string[];
  readonly delivery?: RepairMutationDelivery;
  readonly maxChangedFiles?: number;
};

export type RepairMutationResult = {
  readonly changedFiles: readonly string[];
  readonly commitSha: string;
  readonly pushed: boolean;
  readonly delivery?: RepairMutationDelivery;
  readonly risk?: RepairMutationRisk;
  readonly title?: string;
};

export type CiFailureWorkerInput = {
  request: CiFailureRouteRequest;
  decision: CiFailureRouteDecision;
};

export type CiFailureWorker = Worker<CiFailureWorkerInput, WorkerOutcome> & {
  profile: WorkerProfile;
};

export type CiFailureWorkerMap = {
  readonly [Profile in WorkerProfile]: CiFailureWorker & { readonly profile: Profile };
};
