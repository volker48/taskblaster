import type {
  Difficulty,
  RouteDecision,
  Router,
  TriageCiFailureCandidate,
} from "../domain/index.ts";

export type WorkerProfile = "cheap_ci_worker" | "deep_ci_worker";

export type CiFailureRouterModelOutput = {
  difficulty: Difficulty;
  confidence: number;
  rationale: string;
};

export type CiFailureRouteDecision = RouteDecision<WorkerProfile> & CiFailureRouterModelOutput;

export type CiFailureRouteRequest = TriageCiFailureCandidate;

export type CiFailureRouterModel = {
  classify(request: CiFailureRouteRequest): Promise<CiFailureRouterModelOutput>;
};

export class CiFailureRouter implements Router<CiFailureRouteRequest, WorkerProfile> {
  constructor(private readonly model: CiFailureRouterModel) {}

  route(request: CiFailureRouteRequest): Promise<CiFailureRouteDecision> {
    return routeCiFailure(this.model, request);
  }
}

export async function routeCiFailure(
  model: CiFailureRouterModel,
  request: CiFailureRouteRequest,
): Promise<CiFailureRouteDecision> {
  const decision = await model.classify(request);
  return normalizeDecision(decision);
}

function normalizeDecision(decision: CiFailureRouterModelOutput): CiFailureRouteDecision {
  const difficulty = decision.difficulty;
  const workerId = chooseWorker(difficulty);

  return {
    workerId,
    difficulty,
    confidence: clampConfidence(decision.confidence),
    rationale: decision.rationale.trim(),
  };
}

function chooseWorker(difficulty: Difficulty): WorkerProfile {
  return difficulty === "cheap" ? "cheap_ci_worker" : "deep_ci_worker";
}

function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) {
    return 0;
  }

  return Math.min(Math.max(confidence, 0), 1);
}
