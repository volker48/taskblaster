import type { FlueContext } from "@flue/runtime";
import * as v from "valibot";
import ciFailureRouter from "../agents/ci-failure-router";
import type { CiFailureRouterModel } from "../router/ciFailureRouter";
import { triageCiFailureWorkflow } from "../loops/triageCiFailure";
import { validateCiFailureWorkerMap, type CiFailureWorker } from "../workers/ciFailureWorkers";
import type { TriageCiFailureCandidate } from "../domain";

const RouteDecisionSchema = v.object({
  difficulty: v.picklist(["cheap", "deep"]),
  confidence: v.number(),
  rationale: v.string(),
});

const WorkerOutcomeSchema = v.union([
  v.object({
    status: v.literal("resolved"),
    summary: v.string(),
    mutation: v.optional(
      v.object({
        changedFiles: v.array(v.string()),
        commitSha: v.string(),
        pushed: v.boolean(),
        delivery: v.optional(v.picklist(["direct", "stacked_pr"])),
        risk: v.optional(v.picklist(["low", "extensive", "risky"])),
        title: v.optional(v.string()),
      }),
    ),
  }),
  v.object({
    status: v.literal("unresolved"),
    summary: v.string(),
  }),
]);

export async function run({ init, payload }: FlueContext<TriageCiFailureCandidate>) {
  const harness = await init(ciFailureRouter);
  const session = await harness.session();

  return triageCiFailureWorkflow(payload, {
    routerModel: {
      async classify(candidate) {
        const response = await session.prompt(buildRoutingPrompt(candidate), {
          result: RouteDecisionSchema,
        });

        return response.data;
      },
    } satisfies CiFailureRouterModel,
    workers: validateCiFailureWorkerMap({
      cheap_ci_worker: makeWorker("cheap_ci_worker", session),
      deep_ci_worker: makeWorker("deep_ci_worker", session),
    }),
  });
}

function makeWorker(profile: CiFailureWorker["profile"], session: WorkerSession): CiFailureWorker {
  return {
    profile,
    async attempt(input) {
      const response = await session.task(buildWorkerPrompt(input), {
        agent: profile,
        result: WorkerOutcomeSchema,
      });

      return response.data;
    },
  };
}

function buildRoutingPrompt(candidate: TriageCiFailureCandidate): string {
  return [
    "Classify this CI failure candidate by remediation difficulty.",
    "Return cheap only for simple formatting, linting, or mechanical fixes.",
    "Return deep for semantic bugs, flaky tests, race conditions, or broad changes.",
    JSON.stringify(candidate, null, 2),
  ].join("\n\n");
}

function buildWorkerPrompt(input: Parameters<CiFailureWorker["attempt"]>[0]): string {
  return [
    `You are ${input.decision.workerId}. Attempt the selected CI remediation.`,
    "Fix directly for small safe changes. Use a stacked change for extensive fixes.",
    "For extensive or risky repairs, return a resolved mutation with delivery stacked_pr.",
    "Return unresolved when the work should escalate instead of guessing.",
    JSON.stringify(input.request, null, 2),
  ].join("\n\n");
}

type WorkerSession = {
  task(
    prompt: string,
    options: { agent: CiFailureWorker["profile"]; result: typeof WorkerOutcomeSchema },
  ): Promise<{ data: Awaited<ReturnType<CiFailureWorker["attempt"]>> }>;
};
