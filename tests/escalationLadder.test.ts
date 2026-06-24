import { describe, expect, it } from "vitest";
import { TRIAGE_CI_FAILURE_WORKFLOW, type TriageCiFailureCandidate } from "../src/domain";
import type { CiFailureClassification, WorkerProfile } from "../src/router/ciFailureRouter";
import type { CiFailureWorker, CiFailureWorkerMap } from "../src/workers/ciFailureWorkers";
import { climbEscalationLadder, validateCiFailureWorkerMap } from "../src/escalation/ladder";

const candidate: TriageCiFailureCandidate = {
  workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
  detectedAt: "2026-06-20T14:00:00.000Z",
  input: {
    repository: { provider: "github", owner: "acme", name: "widgets" },
    changeRequest: {
      number: 42,
      title: "Fix lint",
      url: "https://example.test/acme/widgets/pull/42",
      headSha: "abc123",
      baseRef: "main",
      headRef: "fix-lint",
    },
    failures: [{ provider: "github", externalId: "check-1", name: "lint", conclusion: "failure" }],
  },
};

function classification(difficulty: "cheap" | "deep"): CiFailureClassification {
  return { difficulty, confidence: 0.9, rationale: "Test classification." };
}

type AttemptFactory = (profile: WorkerProfile) => CiFailureWorker["attempt"];

function workerMap(factory: AttemptFactory): CiFailureWorkerMap {
  return {
    cheap_ci_worker: { profile: "cheap_ci_worker", attempt: factory("cheap_ci_worker") },
    deep_ci_worker: { profile: "deep_ci_worker", attempt: factory("deep_ci_worker") },
  } satisfies CiFailureWorkerMap;
}

describe("climbEscalationLadder", () => {
  it("enters at the rung matching the classified difficulty and resolves there", async () => {
    const attempted: string[] = [];
    const workers = workerMap((profile) => async () => {
      attempted.push(profile);
      return { status: "resolved", summary: `${profile} fixed it.` };
    });

    const outcome = await climbEscalationLadder(candidate, classification("cheap"), workers);

    expect(attempted).toEqual(["cheap_ci_worker"]);
    expect(outcome).toMatchObject({ status: "resolved", worker: "cheap_ci_worker" });
  });

  it("skips the cheap rung when the failure is classified deep", async () => {
    const attempted: string[] = [];
    const workers = workerMap((profile) => async () => {
      attempted.push(profile);
      return { status: "resolved", summary: `${profile} fixed it.` };
    });

    const outcome = await climbEscalationLadder(candidate, classification("deep"), workers);

    expect(attempted).toEqual(["deep_ci_worker"]);
    expect(outcome).toMatchObject({ status: "resolved", worker: "deep_ci_worker" });
  });

  it("climbs to the next rung when an attempt is unresolved", async () => {
    const attempted: string[] = [];
    const workers = workerMap((profile) => async () => {
      attempted.push(profile);
      return profile === "cheap_ci_worker"
        ? { status: "unresolved", summary: "Cheap could not fix." }
        : { status: "resolved", summary: "Deep fixed it." };
    });

    const outcome = await climbEscalationLadder(candidate, classification("cheap"), workers);

    expect(attempted).toEqual(["cheap_ci_worker", "deep_ci_worker"]);
    expect(outcome).toMatchObject({ status: "resolved", worker: "deep_ci_worker" });
  });

  it("escalates to a human after climbing past the top rung", async () => {
    const workers = workerMap((profile) => async () => {
      return { status: "unresolved", summary: `${profile} could not fix.` };
    });

    const outcome = await climbEscalationLadder(candidate, classification("cheap"), workers);

    expect(outcome).toEqual({
      status: "escalated",
      worker: "deep_ci_worker",
      outcome: { status: "unresolved", summary: "deep_ci_worker could not fix." },
      attemptedWorkers: ["cheap_ci_worker", "deep_ci_worker"],
      reason: "deep_ci_worker exhausted automated remediation.",
    });
  });

  it("hands each worker a decision pinned to its own rung", async () => {
    const seenWorkerIds: string[] = [];
    const workers = workerMap((profile) => async (input) => {
      seenWorkerIds.push(input.decision.workerId);
      expect(input.decision.workerId).toBe(profile);
      expect(input.decision.rationale).toBe("Test classification.");
      return { status: "unresolved", summary: "keep climbing" };
    });

    await climbEscalationLadder(candidate, classification("cheap"), workers);

    expect(seenWorkerIds).toEqual(["cheap_ci_worker", "deep_ci_worker"]);
  });
});

describe("validateCiFailureWorkerMap", () => {
  it("throws when a rung has no registered worker", () => {
    expect(() =>
      validateCiFailureWorkerMap({
        deep_ci_worker: {
          profile: "deep_ci_worker",
          async attempt() {
            return { status: "resolved", summary: "unused" };
          },
        },
      }),
    ).toThrow("Missing CI failure worker profile(s): cheap_ci_worker");
  });

  it("throws when a worker map key points to a mismatched profile", () => {
    expect(() =>
      validateCiFailureWorkerMap({
        cheap_ci_worker: {
          profile: "deep_ci_worker",
          async attempt() {
            return { status: "resolved", summary: "unused" };
          },
        } as unknown as CiFailureWorker,
        deep_ci_worker: {
          profile: "deep_ci_worker",
          async attempt() {
            return { status: "resolved", summary: "unused" };
          },
        },
      }),
    ).toThrow("CI failure worker map key cheap_ci_worker points to profile deep_ci_worker");
  });
});
