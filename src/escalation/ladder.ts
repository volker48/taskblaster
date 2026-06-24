import type { Difficulty } from "../domain/index.ts";
import type {
  CiFailureClassification,
  CiFailureRouteDecision,
  CiFailureRouteRequest,
  WorkerProfile,
} from "../router/ciFailureRouter.ts";
import type {
  CiFailureWorker,
  CiFailureWorkerMap,
  WorkerOutcome,
} from "../workers/ciFailureWorkers.ts";

type LadderRung = {
  readonly difficulty: Difficulty;
  readonly workerId: WorkerProfile;
};

export const ESCALATION_LADDER: readonly LadderRung[] = [
  { difficulty: "cheap", workerId: "cheap_ci_worker" },
  { difficulty: "deep", workerId: "deep_ci_worker" },
];

export const CI_FAILURE_WORKER_PROFILES: readonly WorkerProfile[] = ESCALATION_LADDER.map(
  (rung) => rung.workerId,
);

export type ClimbOutcome =
  | {
      readonly status: "resolved";
      readonly worker: WorkerProfile;
      readonly outcome: Extract<WorkerOutcome, { status: "resolved" }>;
    }
  | {
      readonly status: "escalated";
      readonly worker: WorkerProfile;
      readonly outcome: WorkerOutcome;
      readonly attemptedWorkers: readonly WorkerProfile[];
      readonly reason: string;
    };

export async function climbEscalationLadder(
  request: CiFailureRouteRequest,
  classification: CiFailureClassification,
  workers: CiFailureWorkerMap,
): Promise<ClimbOutcome> {
  const rungs = ESCALATION_LADDER.slice(entryRungIndex(classification.difficulty));
  const attemptedWorkers: WorkerProfile[] = [];
  let lastAttempt: { worker: WorkerProfile; outcome: WorkerOutcome } | undefined;

  for (const rung of rungs) {
    const decision: CiFailureRouteDecision = { ...classification, workerId: rung.workerId };
    const outcome = await workers[rung.workerId].attempt({ request, decision });

    attemptedWorkers.push(rung.workerId);
    lastAttempt = { worker: rung.workerId, outcome };

    if (outcome.status === "resolved") {
      return { status: "resolved", worker: rung.workerId, outcome };
    }
  }

  if (!lastAttempt) {
    throw new Error("Escalation Ladder has no rung for the classified difficulty.");
  }

  return {
    status: "escalated",
    worker: lastAttempt.worker,
    outcome: lastAttempt.outcome,
    attemptedWorkers,
    reason: `${lastAttempt.worker} exhausted automated remediation.`,
  };
}

export function validateCiFailureWorkerMap(
  workers: Partial<Record<WorkerProfile, CiFailureWorker>>,
): CiFailureWorkerMap {
  const missing = CI_FAILURE_WORKER_PROFILES.filter((profile) => !workers[profile]);

  if (missing.length > 0) {
    throw new Error(`Missing CI failure worker profile(s): ${missing.join(", ")}`);
  }

  for (const profile of CI_FAILURE_WORKER_PROFILES) {
    assertWorkerProfile(workers[profile], profile);
  }

  return workers as CiFailureWorkerMap;
}

function entryRungIndex(difficulty: Difficulty): number {
  const index = ESCALATION_LADDER.findIndex((rung) => rung.difficulty === difficulty);

  if (index === -1) {
    throw new Error(`No Escalation Ladder rung for difficulty: ${difficulty}`);
  }

  return index;
}

function assertWorkerProfile(
  worker: CiFailureWorker | undefined,
  expected: WorkerProfile,
): asserts worker is CiFailureWorker {
  if (!worker) {
    throw new Error(`Missing CI failure worker profile: ${expected}`);
  }

  if (worker.profile !== expected) {
    throw new Error(`CI failure worker map key ${expected} points to profile ${worker.profile}`);
  }
}
