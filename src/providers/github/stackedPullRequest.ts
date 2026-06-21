import type { TriageCiFailureCandidate } from "../../domain/index.ts";
import type { RepairMutationResult } from "../../workers/ciFailureWorkers.ts";

export type StackedPullRequestRequest = {
  readonly repository: {
    readonly owner: string;
    readonly name: string;
  };
  readonly baseRef: string;
  readonly headSha: string;
  readonly originalPullRequest: {
    readonly number: number;
    readonly url: string;
    readonly headRef: string;
  };
  readonly title: string;
  readonly body: string;
  readonly mutation: RepairMutationResult;
};

export type StackedPullRequestResult = {
  readonly number: number;
  readonly url: string;
  readonly headRef: string;
};

export interface StackedPullRequestCreator {
  createStackedPullRequest(
    request: StackedPullRequestRequest,
  ): Promise<StackedPullRequestResult>;
}

export function buildStackedPullRequestRequest(
  candidate: TriageCiFailureCandidate,
  mutation: RepairMutationResult,
): StackedPullRequestRequest {
  const changeRequest = candidate.input.changeRequest;

  return {
    repository: {
      owner: candidate.input.repository.owner,
      name: candidate.input.repository.name,
    },
    baseRef: changeRequest.headRef,
    headSha: changeRequest.headSha,
    originalPullRequest: {
      number: changeRequest.number,
      url: changeRequest.url,
      headRef: changeRequest.headRef,
    },
    title: mutation.title ?? `Repair CI failure for PR #${changeRequest.number}`,
    body: buildStackedPullRequestBody(candidate, mutation),
    mutation,
  };
}

function buildStackedPullRequestBody(
  candidate: TriageCiFailureCandidate,
  mutation: RepairMutationResult,
): string {
  const failures = candidate.input.failures
    .map((failure) => `- ${failure.name} (${failure.conclusion})`)
    .join("\n");

  return [
    `Stacked repair for ${candidate.input.changeRequest.url}`,
    `Accepted candidate detected at ${candidate.detectedAt}.`,
    `Original head SHA: ${candidate.input.changeRequest.headSha}`,
    "",
    "Failed checks:",
    failures,
    "",
    "Repair mutation:",
    `- Commit: ${mutation.commitSha}`,
    `- Changed files: ${mutation.changedFiles.join(", ")}`,
  ].join("\n");
}
