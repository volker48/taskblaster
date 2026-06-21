import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TRIAGE_CI_FAILURE_WORKFLOW } from "../src/domain";
import { triageCiFailureWorkflow } from "../src/loops/triageCiFailure";
import {
  detectGitLabCiFailures,
  GitLabCiFailureDetector,
  type GitLabCiObservation,
} from "../src/providers/gitlab";
import type { CiFailureWorkerMap } from "../src/workers/ciFailureWorkers";

const fixture = JSON.parse(
  readFileSync("fixtures/gitlab/merge-request-pipelines.json", "utf8"),
) as GitLabCiObservation;

describe("detectGitLabCiFailures", () => {
  it("admits one provider-neutral candidate for failed merge request pipelines", () => {
    const candidates = detectGitLabCiFailures(fixture);

    expect(candidates).toEqual([
      {
        workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
        detectedAt: fixture.observedAt,
        input: {
          repository: {
            provider: "gitlab",
            owner: "acme",
            name: "widgets",
          },
          changeRequest: {
            number: 42,
            title: "Fix lint",
            url: "https://gitlab.example.test/acme/widgets/-/merge_requests/42",
            headSha: "abc123",
            baseRef: "main",
            headRef: "fix-lint",
          },
          failures: [
            {
              provider: "gitlab",
              externalId: "1001",
              name: "lint",
              conclusion: "failure",
              detailsUrl: "https://gitlab.example.test/acme/widgets/-/pipelines/1001",
            },
            {
              provider: "gitlab",
              externalId: "1003",
              name: "test",
              conclusion: "cancelled",
            },
          ],
        },
      },
    ]);
  });

  it("ignores passing, pending, skipped, and non-actionable pipelines", () => {
    const candidates = detectGitLabCiFailures({
      ...fixture,
      pipelines: [
        { id: 1001, name: "build", status: "success" },
        { id: 1002, name: "lint", status: "pending" },
        { id: 1003, name: "docs", status: "skipped" },
        { id: 1004, name: "deploy", status: "manual" },
        { id: 1005, name: "test", status: "running" },
      ],
    });

    expect(candidates).toEqual([]);
  });

  it("exposes the same admission behavior through the Detector interface", () => {
    const detector = new GitLabCiFailureDetector();

    expect(
      detector.detect({
        ...fixture,
        pipelines: [{ id: 1001, status: "failed" }],
      }),
    ).toHaveLength(1);
  });

  it("runs GitLab-origin candidates through the existing workflow runner", async () => {
    const [candidate] = detectGitLabCiFailures(fixture);

    const result = await triageCiFailureWorkflow(candidate, {
      routerModel: {
        async classify() {
          return {
            difficulty: "cheap",
            confidence: 0.95,
            rationale: "Formatter pipeline failed.",
          };
        },
      },
      workers: resolvedWorkers(),
    });

    expect(result).toMatchObject({
      status: "resolved",
      worker: "cheap_ci_worker",
      outcome: { status: "resolved", summary: "Fixed GitLab CI failure." },
    });
  });
});

function resolvedWorkers(): CiFailureWorkerMap {
  return {
    cheap_ci_worker: {
      profile: "cheap_ci_worker",
      async attempt() {
        return { status: "resolved", summary: "Fixed GitLab CI failure." };
      },
    },
    deep_ci_worker: {
      profile: "deep_ci_worker",
      async attempt() {
        throw new Error("Deep worker should not run.");
      },
    },
  };
}
