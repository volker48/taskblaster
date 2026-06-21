import { describe, expect, it } from "vitest";
import { TRIAGE_CI_FAILURE_WORKFLOW, type TriageCiFailureCandidate } from "../src/domain";
import { runTriageCiFailureLoop, triageCiFailureWorkflow } from "../src/loops/triageCiFailure";
import type { CiFailureRouterModel } from "../src/router/ciFailureRouter";
import { run } from "../src/workflows/triage-ci-failure";
import type { CiFailureWorkerMap } from "../src/workers/ciFailureWorkers";
import { getRuntimeTargetConfig, validateRuntimeTargetSecrets } from "../src/runtimeTargets";
import {
  buildHumanEscalationCommentBody,
  createGitHubHumanEscalationPublisher,
  type GitHubIssueCommentRequest,
  type StackedPullRequestRequest,
} from "../src/providers/github";

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

  it("runs candidates within the Mutation Cap and reports deferred candidates", async () => {
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

          return {
            status: "resolved" as const,
            summary: "Fixed formatting.",
            mutation: {
              changedFiles: ["README.md"],
              commitSha: "def456",
              pushed: true,
            },
          };
        },
      },
      deep_ci_worker: {
        profile: "deep_ci_worker",
        async attempt() {
          throw new Error("Deep worker should not run.");
        },
      },
    } satisfies CiFailureWorkerMap;

    const results = await runTriageCiFailureLoop([candidate, candidate, candidate], {
      routerModel,
      workers,
      mutationCap: { limit: 2, active: 1 },
    });

    expect(routedCount).toBe(1);
    expect(attemptedCount).toBe(1);
    expect(results.map((result) => result.status)).toEqual(["completed", "capped", "capped"]);
    expect(results[0]).toMatchObject({
      result: {
        status: "resolved",
        outcome: { mutation: { commitSha: "def456", pushed: true } },
      },
    });
    expect(results[1]).toMatchObject({
      status: "capped",
      workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
      reason: "Mutation Cap exhausted; candidate deferred before Repair Mutation.",
      mutationCap: { limit: 2, active: 1, available: 1 },
    });
  });

  it("passes stacked pull request creation into workflow runs", async () => {
    const stackedRequests: StackedPullRequestRequest[] = [];
    const workers = {
      cheap_ci_worker: {
        profile: "cheap_ci_worker",
        async attempt() {
          throw new Error("Cheap worker should not run.");
        },
      },
      deep_ci_worker: {
        profile: "deep_ci_worker",
        async attempt() {
          return {
            status: "resolved" as const,
            summary: "Correctness fix prepared.",
            mutation: {
              changedFiles: ["src/widgets.ts"],
              commitSha: "def456",
              pushed: true,
              delivery: "stacked_pr" as const,
              risk: "risky" as const,
            },
          };
        },
      },
    } satisfies CiFailureWorkerMap;

    const results = await runTriageCiFailureLoop([candidate], {
      routerModel: {
        async classify() {
          return {
            difficulty: "deep",
            confidence: 0.95,
            rationale: "Semantic test failure.",
          };
        },
      },
      workers,
      stackedPullRequests: {
        async createStackedPullRequest(request) {
          stackedRequests.push(request);

          return {
            number: 77,
            url: "https://example.test/acme/widgets/pull/77",
            headRef: "taskblaster/repair-42",
          };
        },
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: "completed",
      result: {
        status: "resolved",
        worker: "deep_ci_worker",
        stackedPullRequest: { number: 77 },
      },
    });
    expect(stackedRequests).toHaveLength(1);
    expect(stackedRequests[0]).toMatchObject({
      baseRef: "fix-lint",
      originalPullRequest: { number: 42 },
    });
  });

  it("does not route or attempt workers when the Mutation Cap is exhausted", async () => {
    let routed = false;
    let attempted = false;
    const workers = {
      cheap_ci_worker: {
        profile: "cheap_ci_worker",
        async attempt() {
          attempted = true;

          return { status: "resolved" as const, summary: "Unexpected." };
        },
      },
      deep_ci_worker: {
        profile: "deep_ci_worker",
        async attempt() {
          attempted = true;

          return { status: "resolved" as const, summary: "Unexpected." };
        },
      },
    } satisfies CiFailureWorkerMap;

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
      workers,
      mutationCap: { limit: 1, active: 1 },
    });

    expect(routed).toBe(false);
    expect(attempted).toBe(false);
    expect(results).toEqual([
      {
        status: "capped",
        workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
        candidate,
        reason: "Mutation Cap exhausted; candidate deferred before Repair Mutation.",
        mutationCap: { limit: 1, active: 1, available: 0 },
      },
    ]);
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
  it("opens extensive deep worker Repair Mutations as stacked pull requests", async () => {
    const stackedRequests: StackedPullRequestRequest[] = [];
    const result = await triageCiFailureWorkflow(candidate, {
      routerModel: {
        async classify() {
          return {
            difficulty: "deep",
            confidence: 0.95,
            rationale: "Semantic test failure.",
          };
        },
      },
      workers: {
        cheap_ci_worker: {
          profile: "cheap_ci_worker",
          async attempt() {
            throw new Error("Cheap worker should not run.");
          },
        },
        deep_ci_worker: {
          profile: "deep_ci_worker",
          async attempt() {
            return {
              status: "resolved",
              summary: "Correctness fix prepared.",
              mutation: {
                changedFiles: ["src/widgets.ts"],
                commitSha: "def456",
                pushed: true,
                delivery: "stacked_pr",
                risk: "risky",
                title: "Fix widget race condition",
              },
            };
          },
        },
      },
      stackedPullRequests: {
        async createStackedPullRequest(request) {
          stackedRequests.push(request);

          return {
            number: 77,
            url: "https://example.test/acme/widgets/pull/77",
            headRef: "taskblaster/repair-42",
          };
        },
      },
    });

    expect(result).toMatchObject({
      status: "resolved",
      worker: "deep_ci_worker",
      stackedPullRequest: { number: 77 },
    });
    expect(stackedRequests).toHaveLength(1);
    expect(stackedRequests[0]).toMatchObject({
      baseRef: "fix-lint",
      headSha: "abc123",
      originalPullRequest: { number: 42 },
      title: "Fix widget race condition",
    });
    expect(stackedRequests[0]?.body).toContain(candidate.input.changeRequest.url);
    expect(stackedRequests[0]?.body).toContain(candidate.detectedAt);
  });

  it("publishes a human escalation output when deep automation is exhausted", async () => {
    const comments: GitHubIssueCommentRequest[] = [];
    const publisher = createGitHubHumanEscalationPublisher({
      async createIssueComment(request) {
        comments.push(request);
      },
    });
    const result = await triageCiFailureWorkflow(candidate, {
      routerModel: cheapRouter(),
      workers: unresolvedWorkers(),
      humanEscalationPublisher: publisher,
    });

    expect(result).toMatchObject({
      status: "escalated",
      worker: "deep_ci_worker",
      attemptedWorkers: ["cheap_ci_worker", "deep_ci_worker"],
      escalation: { target: "human" },
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      repository: { owner: "acme", name: "widgets" },
      issueNumber: 42,
    });
    expect(comments[0]?.body).toContain("Human escalation required");
    expect(comments[0]?.body).toContain("Pull request: https://example.test/acme/widgets/pull/42");
    expect(comments[0]?.body).toContain("Attempted workers: cheap_ci_worker -> deep_ci_worker");
    expect(comments[0]?.body).toContain("Failure summary: Deep worker could not fix safely.");
    expect(comments[0]?.body).not.toContain("token");
    expect(comments[0]?.body).not.toContain("SECRET");
  });

  it("builds provider-visible human escalation comments with reviewer context", () => {
    const body = buildHumanEscalationCommentBody({
      candidate,
      failureSummary: "Deep worker could not fix safely.",
      attemptedWorkers: ["cheap_ci_worker", "deep_ci_worker"],
      recommendedAction: "Inspect the failing lint check and update the branch manually.",
    });

    expect(body).toContain("Repository: acme/widgets");
    expect(body).toContain("Head SHA: abc123");
    expect(body).toContain("- lint (failure)");
    expect(body).toContain("Inspect the failing lint check");
    expect(body).not.toContain(process.env.GITHUB_TOKEN ?? "unavailable-token");
  });

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

    await expect(triageCiFailureWorkflow(candidate, { routerModel, workers })).rejects.toThrow(
      "Missing CI failure worker profile(s): cheap_ci_worker",
    );
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

function cheapRouter(): CiFailureRouterModel {
  return {
    async classify() {
      return {
        difficulty: "cheap",
        confidence: 0.95,
        rationale: "Formatting failure.",
      };
    },
  };
}

function unresolvedWorkers(): CiFailureWorkerMap {
  return {
    cheap_ci_worker: {
      profile: "cheap_ci_worker",
      async attempt() {
        return { status: "unresolved", summary: "Cheap worker could not fix." };
      },
    },
    deep_ci_worker: {
      profile: "deep_ci_worker",
      async attempt() {
        return { status: "unresolved", summary: "Deep worker could not fix safely." };
      },
    },
  };
}

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
