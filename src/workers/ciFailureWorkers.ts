import type {
  CiFailureRouteRequest,
  CiFailureRouteDecision,
  WorkerProfile,
} from "../router/ciFailureRouter";
import type { Escalation, Worker } from "../domain";

export type WorkerOutcome =
  | { status: "resolved"; summary: string }
  | { status: "unresolved"; summary: string };

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

export const CI_FAILURE_WORKER_PROFILES: readonly WorkerProfile[] = [
  "cheap_ci_worker",
  "deep_ci_worker",
];

export function nextEscalation(from: WorkerProfile): Escalation<WorkerProfile> {
  if (from === "cheap_ci_worker") {
    return {
      target: "worker",
      workerId: "deep_ci_worker",
      reason: "Cheap worker could not resolve the CI failure.",
    };
  }

  return {
    target: "human",
    reason: "Deep worker exhausted automated remediation.",
  };
}

export function validateCiFailureWorkerMap(
  workers: Partial<Record<WorkerProfile, CiFailureWorker>>,
): CiFailureWorkerMap {
  const missing = CI_FAILURE_WORKER_PROFILES.filter((profile) => !workers[profile]);

  if (missing.length > 0) {
    throw new Error(`Missing CI failure worker profile(s): ${missing.join(", ")}`);
  }

  assertWorkerProfile(workers.cheap_ci_worker, "cheap_ci_worker");
  assertWorkerProfile(workers.deep_ci_worker, "deep_ci_worker");

  return workers as CiFailureWorkerMap;
}

function assertWorkerProfile(
  worker: CiFailureWorker | undefined,
  expected: WorkerProfile,
): asserts worker is CiFailureWorker {
  if (!worker) {
    throw new Error(`Missing CI failure worker profile: ${expected}`);
  }

  if (worker.profile !== expected) {
    throw new Error(
      `CI failure worker map key ${expected} points to profile ${worker.profile}`,
    );
  }
}
