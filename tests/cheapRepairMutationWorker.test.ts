import { describe, expect, it } from "vitest";
import { TRIAGE_CI_FAILURE_WORKFLOW, type TriageCiFailureCandidate } from "../src/domain";
import { triageCiFailureWorkflow } from "../src/loops/triageCiFailure";
import type { CiFailureRouterModel } from "../src/router/ciFailureRouter";
import {
  createCheapRepairMutationWorker,
  type BranchMutationDriver,
} from "../src/workers/cheapRepairMutationWorker";
import type { CiFailureWorkerMap } from "../src/workers/ciFailureWorkers";

const lintCandidate: TriageCiFailureCandidate = {
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

describe("cheap repair mutation worker", () => {
  it("applies, commits, and pushes bounded mechanical repair mutations", async () => {
    const mutationRequests: Parameters<BranchMutationDriver["apply"]>[0][] = [];
    const workers = makeWorkers({
      async apply(request) {
        mutationRequests.push(request);

        return {
          changedFiles: ["src/widgets.ts"],
          commitSha: "def456",
          pushed: true,
        };
      },
    });

    const result = await triageCiFailureWorkflow(lintCandidate, {
      routerModel: cheapRouter(),
      workers,
    });

    expect(mutationRequests).toEqual([
      {
        candidate: lintCandidate,
        plan: {
          kind: "lint",
          delivery: "direct",
          failureNames: ["lint"],
          maxChangedFiles: 20,
        },
        requireTrustedBranch: true,
      },
    ]);
    expect(result).toMatchObject({
      status: "resolved",
      worker: "cheap_ci_worker",
      outcome: {
        status: "resolved",
        mutation: {
          changedFiles: ["src/widgets.ts"],
          commitSha: "def456",
          pushed: true,
        },
      },
    });
  });

  it("returns unresolved for semantic failures and escalates without mutation", async () => {
    let mutationAttempted = false;
    const workers = makeWorkers({
      async apply() {
        mutationAttempted = true;

        return {
          changedFiles: ["src/widgets.ts"],
          commitSha: "def456",
          pushed: true,
        };
      },
    });

    const result = await triageCiFailureWorkflow(
      {
        ...lintCandidate,
        input: {
          ...lintCandidate.input,
          failures: [
            {
              provider: "github",
              externalId: "check-2",
              name: "integration test",
              conclusion: "failure",
            },
          ],
        },
      },
      {
        routerModel: cheapRouter(),
        workers,
      },
    );

    expect(mutationAttempted).toBe(false);
    expect(result).toMatchObject({
      status: "escalated",
      worker: "deep_ci_worker",
      outcome: { status: "unresolved" },
      attemptedWorkers: ["cheap_ci_worker", "deep_ci_worker"],
      reason: "deep_ci_worker exhausted automated remediation.",
    });
  });
});

function cheapRouter(): CiFailureRouterModel {
  return {
    async classify() {
      return {
        difficulty: "cheap",
        confidence: 0.95,
        rationale: "Mechanical CI failure.",
      };
    },
  };
}

function makeWorkers(branchMutations: BranchMutationDriver): CiFailureWorkerMap {
  return {
    cheap_ci_worker: createCheapRepairMutationWorker(branchMutations),
    deep_ci_worker: {
      profile: "deep_ci_worker",
      async attempt() {
        return {
          status: "unresolved",
          summary: "Needs human review.",
        };
      },
    },
  };
}
