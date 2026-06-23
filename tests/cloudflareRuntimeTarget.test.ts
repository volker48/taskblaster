import { describe, expect, it } from "vitest";
import { TRIAGE_CI_FAILURE_WORKFLOW, type TriageCiFailureCandidate } from "../src/domain";
import {
  parseAcceptedCandidates,
  runCloudflareScheduledTriage,
  type CloudflareScheduledTriageEnv,
} from "../src/cloudflare";

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

describe("Cloudflare Runtime Target", () => {
  it("parses empty, single, and batched Accepted Candidate payloads", () => {
    expect(parseAcceptedCandidates(undefined)).toEqual([]);
    expect(parseAcceptedCandidates(JSON.stringify(candidate))).toEqual([candidate]);
    expect(parseAcceptedCandidates(JSON.stringify([candidate, candidate]))).toEqual([
      candidate,
      candidate,
    ]);
  });

  it("dispatches one workflow request per Accepted Candidate from cron", async () => {
    const requests: Request[] = [];
    const ids: string[] = [];
    const env: CloudflareScheduledTriageEnv = {
      TASKBLASTER_ACCEPTED_CANDIDATES_JSON: JSON.stringify([candidate, candidate]),
      FLUE_TRIAGE_CI_FAILURE_WORKFLOW: {
        idFromName(name) {
          ids.push(name);

          return name;
        },
        get() {
          return {
            async fetch(request) {
              requests.push(request);

              return new Response(null, { status: 202 });
            },
          };
        },
      },
    };

    const results = await runCloudflareScheduledTriage(env);

    expect(ids).toEqual(["github:acme:widgets:42:abc123", "github:acme:widgets:42:abc123"]);
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.method)).toEqual(["POST", "POST"]);
    expect(requests[0]?.url).toBe("https://taskblaster.internal/workflows/triage-ci-failure");
    await expect(requests[0]?.json()).resolves.toEqual(candidate);
    expect(results.map((result) => result.status)).toEqual([202, 202]);
  });

  it("fails clearly when candidates exist but the workflow binding is missing", async () => {
    await expect(
      runCloudflareScheduledTriage({
        TASKBLASTER_ACCEPTED_CANDIDATES_JSON: JSON.stringify(candidate),
      }),
    ).rejects.toThrow("Missing Cloudflare binding: FLUE_TRIAGE_CI_FAILURE_WORKFLOW.");
  });
});
