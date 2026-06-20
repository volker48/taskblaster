import { describe, expect, it } from "vitest";
import {
  TRIAGE_CI_FAILURE_WORKFLOW,
  type TriageCiFailureCandidate,
} from "../src/domain";
import { triageCiFailureWorkflow } from "../src/loops/triageCiFailure";
import type { CiFailureRouterModel } from "../src/router/ciFailureRouter";
import { run } from "../src/workflows/triage-ci-failure";
import type { CiFailureWorkerMap } from "../src/workers/ciFailureWorkers";

const candidate: TriageCiFailureCandidate = {
  workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
  detectedAt: "2026-06-20T14:00:00.000Z",
  input: {
    repository: {
      provider: "github",
      owner: "acme",
      name: "widgets",
    },
    changeRequest: {
      number: 42,
      title: "Fix lint",
      url: "https://example.test/acme/widgets/pull/42",
      headSha: "abc123",
      baseRef: "main",
      headRef: "fix-lint",
    },
    failures: [
      {
        provider: "github",
        externalId: "check-1",
        name: "lint",
        conclusion: "failure",
      },
    ],
  },
};

describe("triageCiFailureWorkflow", () => {
  it("fails before invocation when the routed worker profile is not registered", async () => {
    const routerModel: CiFailureRouterModel = {
      async classify() {
        return {
          difficulty: "cheap",
          confidence: 0.95,
          rationale: "Formatting failure.",
        };
      },
    };
    let deepAttempted = false;
    const workers = {
      deep_ci_worker: {
        profile: "deep_ci_worker",
        async attempt() {
          deepAttempted = true;

          return { status: "resolved", summary: "Unexpected worker call." };
        },
      },
    } as unknown as CiFailureWorkerMap;

    await expect(
      triageCiFailureWorkflow(candidate, { routerModel, workers }),
    ).rejects.toThrow("Missing CI failure worker profile(s): cheap_ci_worker");
    expect(deepAttempted).toBe(false);
  });
});

describe("triage CI failure workflow entrypoint", () => {
  it("maps routed and escalated profiles to the matching subagent names", async () => {
    const taskAgents: string[] = [];
    const session = {
      async prompt() {
        return {
          data: {
            difficulty: "cheap",
            confidence: 0.95,
            rationale: "Formatting failure.",
          },
        };
      },
      async task(_prompt: string, options: { agent: string }) {
        taskAgents.push(options.agent);

        return {
          data:
            taskAgents.length === 1
              ? { status: "unresolved" as const, summary: "Needs deeper analysis." }
              : { status: "resolved" as const, summary: "Fixed by deep worker." },
        };
      },
    };
    const context = {
      payload: candidate,
      async init() {
        return {
          async session() {
            return session;
          },
        };
      },
    };

    const result = await run(context as unknown as Parameters<typeof run>[0]);

    expect(taskAgents).toEqual(["cheap_ci_worker", "deep_ci_worker"]);
    expect(result).toMatchObject({
      status: "resolved",
      worker: "deep_ci_worker",
      outcome: { status: "resolved" },
    });
  });
});
