import { describe, expect, it } from "vitest";
import {
  TRIAGE_CI_FAILURE_WORKFLOW,
  type TriageCiFailureCandidate,
} from "../src/domain";
import {
  runTriageCiFailureLoop,
  triageCiFailureWorkflow,
} from "../src/loops/triageCiFailure";
import type { CiFailureRouterModel } from "../src/router/ciFailureRouter";
import { run } from "../src/workflows/triage-ci-failure";
import type { CiFailureWorkerMap } from "../src/workers/ciFailureWorkers";
import {
  getRuntimeTargetConfig,
  validateRuntimeTargetSecrets,
} from "../src/runtimeTargets";

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

describe("runTriageCiFailureLoop", () => {
  it("runs one workflow per accepted candidate", async () => {
    let routedCount = 0;
    let attemptedCount = 0;
    const routerModel: CiFailureRouterModel = {
      async classify() {
        routedCount += 1;

        return {
          difficulty: "cheap",
          confidence: 0.95,
          rationale: "Formatting failure.",
        };
      },
    };
    const workers = {
      cheap_ci_worker: {
        profile: "cheap_ci_worker",
        async attempt() {
          attemptedCount += 1;

          return { status: "resolved" as const, summary: "Fixed formatting." };
        },
      },
      deep_ci_worker: {
        profile: "deep_ci_worker",
        async attempt() {
          throw new Error("Deep worker should not run.");
        },
      },
    } satisfies CiFailureWorkerMap;

    const results = await runTriageCiFailureLoop([candidate, candidate], {
      routerModel,
      workers,
    });

    expect(routedCount).toBe(2);
    expect(attemptedCount).toBe(2);
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.status)).toEqual(["completed", "completed"]);
    expect(results[0]).toMatchObject({
      workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
      result: { status: "resolved", worker: "cheap_ci_worker" },
    });
  });

  it("reports no candidate when there is nothing to run", async () => {
    const results = await runTriageCiFailureLoop([], {
      routerModel: {
        async classify() {
          throw new Error("Router should not run.");
        },
      },
      workers: {},
    });

    expect(results).toEqual([
      {
        status: "no_candidate",
        workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
        reason: "No accepted CI failure candidates to run.",
      },
    ]);
  });

  it("reports worker mapping failures before routing or worker attempts", async () => {
    let routed = false;
    let attempted = false;
    const results = await runTriageCiFailureLoop([candidate], {
      routerModel: {
        async classify() {
          routed = true;

          return {
            difficulty: "cheap",
            confidence: 0.95,
            rationale: "Formatting failure.",
          };
        },
      },
      workers: {
        deep_ci_worker: {
          profile: "deep_ci_worker",
          async attempt() {
            attempted = true;

            return { status: "resolved" as const, summary: "Unexpected." };
          },
        },
      },
    });

    expect(routed).toBe(false);
    expect(attempted).toBe(false);
    expect(results).toEqual([
      {
        status: "failed",
        workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
        reason:
          "CI failure loop is misconfigured: Missing CI failure worker profile(s): cheap_ci_worker",
      },
    ]);
  });
});

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

describe("Runtime Target configuration", () => {
  it("names local and Node targets with explicit command paths", () => {
    expect(getRuntimeTargetConfig("local")).toMatchObject({
      name: "local",
      command: "pnpm loop:local -- <payload.json>",
      mutatesProvider: false,
      requiredSecrets: [],
    });
    expect(getRuntimeTargetConfig("node")).toMatchObject({
      name: "node",
      command: "pnpm flue:run:triage-ci-failure",
      mutatesProvider: false,
      requiredSecrets: ["GITHUB_TOKEN", "FLUE_API_KEY", "OPENAI_API_KEY"],
    });
  });

  it("reports unset or blank Runtime Target secrets", () => {
    const config = getRuntimeTargetConfig("node");

    expect(
      validateRuntimeTargetSecrets(config, {
        GITHUB_TOKEN: "github-token",
        FLUE_API_KEY: "",
      }),
    ).toEqual(["FLUE_API_KEY", "OPENAI_API_KEY"]);
  });
});
