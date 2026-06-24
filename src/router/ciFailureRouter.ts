import type { Difficulty, TriageCiFailureCandidate } from "../domain/index.ts";

export type WorkerProfile = "cheap_ci_worker" | "deep_ci_worker";

export type CiFailureClassification = {
  difficulty: Difficulty;
  confidence: number;
  rationale: string;
};

export type CiFailureRouteDecision = CiFailureClassification & {
  workerId: WorkerProfile;
};

export type CiFailureRouteRequest = TriageCiFailureCandidate;

export type CiFailureRouterModel = {
  classify(request: CiFailureRouteRequest): Promise<CiFailureClassification>;
};

export async function routeCiFailure(
  model: CiFailureRouterModel,
  request: CiFailureRouteRequest,
): Promise<CiFailureClassification> {
  const classification = await model.classify(request);
  return normalizeClassification(classification);
}

function normalizeClassification(classification: CiFailureClassification): CiFailureClassification {
  return {
    difficulty: classification.difficulty,
    confidence: clampConfidence(classification.confidence),
    rationale: classification.rationale.trim(),
  };
}

function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) {
    return 0;
  }

  return Math.min(Math.max(confidence, 0), 1);
}
