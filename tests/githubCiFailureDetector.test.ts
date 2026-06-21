import { describe, expect, it } from "vitest";
import { TRIAGE_CI_FAILURE_WORKFLOW } from "../src/domain";
import {
  detectGitHubCiFailures,
  GitHubCiFailureDetector,
  type GitHubCiObservation,
} from "../src/providers/github";

const observation: GitHubCiObservation = {
  repository: {
    owner: "acme",
    name: "widgets",
  },
  pullRequest: {
    number: 42,
    title: "Fix lint",
    url: "https://github.com/acme/widgets/pull/42",
    headSha: "abc123",
    baseRef: "main",
    headRef: "fix-lint",
  },
  observedAt: "2026-06-20T14:00:00.000Z",
  checkRuns: [],
};

describe("detectGitHubCiFailures", () => {
  it("admits one provider-neutral candidate for failed checks on a pull request", () => {
    const candidates = detectGitHubCiFailures({
      ...observation,
      checkRuns: [
        {
          id: 1001,
          name: "lint",
          status: "completed",
          conclusion: "failure",
          detailsUrl: "https://github.com/acme/widgets/actions/runs/1001",
        },
        {
          id: 1002,
          name: "test",
          status: "completed",
          conclusion: "timed_out",
        },
      ],
    });

    expect(candidates).toEqual([
      {
        workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
        detectedAt: observation.observedAt,
        input: {
          repository: {
            provider: "github",
            owner: "acme",
            name: "widgets",
          },
          changeRequest: observation.pullRequest,
          failures: [
            {
              provider: "github",
              externalId: "1001",
              name: "lint",
              conclusion: "failure",
              detailsUrl: "https://github.com/acme/widgets/actions/runs/1001",
            },
            {
              provider: "github",
              externalId: "1002",
              name: "test",
              conclusion: "timed_out",
            },
          ],
        },
      },
    ]);
  });

  it("ignores passing, pending, skipped, and neutral check runs", () => {
    const candidates = detectGitHubCiFailures({
      ...observation,
      checkRuns: [
        {
          id: 1001,
          name: "build",
          status: "completed",
          conclusion: "success",
        },
        {
          id: 1002,
          name: "lint",
          status: "in_progress",
          conclusion: null,
        },
        {
          id: 1003,
          name: "docs",
          status: "completed",
          conclusion: "skipped",
        },
        {
          id: 1004,
          name: "coverage",
          status: "completed",
          conclusion: "neutral",
        },
      ],
    });

    expect(candidates).toEqual([]);
  });

  it("exposes the same admission behavior through the Detector interface", () => {
    const detector = new GitHubCiFailureDetector();

    expect(
      detector.detect({
        ...observation,
        checkRuns: [
          {
            id: 1001,
            name: "lint",
            status: "completed",
            conclusion: "startup_failure",
          },
        ],
      }),
    ).toHaveLength(1);
  });
});
