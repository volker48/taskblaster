import { readFileSync } from "node:fs";
import { triageCiFailureWorkflow } from "../loops/triageCiFailure.ts";
import type { TriageCiFailureCandidate } from "../domain/index.ts";
import type { CiFailureRouterModel } from "../router/ciFailureRouter.ts";
import { validateCiFailureWorkerMap, type CiFailureWorker } from "../workers/ciFailureWorkers.ts";

const localRouterModel: CiFailureRouterModel = {
  async classify(candidate) {
    const hasDeepSignal = candidate.input.failures.some((failure) =>
      /test|race|flake|semantic|integration/i.test(failure.name),
    );

    return {
      difficulty: hasDeepSignal ? "deep" : "cheap",
      confidence: 0.8,
      rationale: "Local dry-run heuristic; no model provider was called.",
    };
  },
};

const payloadPath = process.argv.at(-1);

if (!payloadPath || payloadPath === "--") {
  throw new Error("Usage: pnpm loop:local -- <payload.json>");
}

const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as TriageCiFailureCandidate;
const result = await triageCiFailureWorkflow(payload, {
  routerModel: localRouterModel,
  workers: validateCiFailureWorkerMap({
    cheap_ci_worker: localWorker("cheap_ci_worker"),
    deep_ci_worker: localWorker("deep_ci_worker"),
  }),
});

console.log(JSON.stringify(result, null, 2));

function localWorker(profile: CiFailureWorker["profile"]): CiFailureWorker {
  return {
    profile,
    async attempt() {
      return {
        status: "unresolved",
        summary: `${profile} dry run completed without mutating the provider.`,
      };
    },
  };
}
