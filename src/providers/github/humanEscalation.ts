import type { HumanEscalationOutput, ProviderResolvedOutput } from "../../loops/triageCiFailure.ts";
import type { TriageCiFailureCandidate } from "../../domain/index.ts";

export type GitHubIssueCommentRequest = {
  readonly repository: {
    readonly owner: string;
    readonly name: string;
  };
  readonly issueNumber: number;
  readonly body: string;
};

export interface GitHubIssueCommentCreator {
  createIssueComment(request: GitHubIssueCommentRequest): Promise<void>;
}

export function createGitHubHumanEscalationPublisher(comments: GitHubIssueCommentCreator) {
  return {
    async publish(output: HumanEscalationOutput): Promise<void> {
      await comments.createIssueComment({
        repository: {
          owner: output.candidate.input.repository.owner,
          name: output.candidate.input.repository.name,
        },
        issueNumber: output.candidate.input.changeRequest.number,
        body: buildHumanEscalationCommentBody(output),
      });
    },
  };
}

export function createGitHubProviderActivityPublisher(comments: GitHubIssueCommentCreator) {
  return {
    async publishAccepted(candidate: TriageCiFailureCandidate): Promise<void> {
      await comments.createIssueComment({
        repository: {
          owner: candidate.input.repository.owner,
          name: candidate.input.repository.name,
        },
        issueNumber: candidate.input.changeRequest.number,
        body: buildAcceptedCandidateCommentBody(candidate),
      });
    },
    async publishResolved(output: ProviderResolvedOutput): Promise<void> {
      await comments.createIssueComment({
        repository: {
          owner: output.candidate.input.repository.owner,
          name: output.candidate.input.repository.name,
        },
        issueNumber: output.candidate.input.changeRequest.number,
        body: buildResolvedOutcomeCommentBody(output),
      });
    },
  };
}

export function buildAcceptedCandidateCommentBody(candidate: TriageCiFailureCandidate): string {
  const failures = candidate.input.failures.map(formatFailure).join("\n");

  return [
    "## Accepted CI failure candidate",
    "",
    "Taskblaster accepted this failed change request for automated remediation.",
    "",
    "### Candidate context",
    `- Workflow: ${candidate.workflowName}`,
    `- Pull request: ${candidate.input.changeRequest.url}`,
    `- Repository: ${candidate.input.repository.owner}/${candidate.input.repository.name}`,
    `- Head ref: ${candidate.input.changeRequest.headRef}`,
    `- Head SHA: ${candidate.input.changeRequest.headSha}`,
    `- Detected at: ${candidate.detectedAt}`,
    "",
    "### Failed checks",
    failures,
  ].join("\n");
}

export function buildResolvedOutcomeCommentBody(output: ProviderResolvedOutput): string {
  const mutation = output.result.outcome.mutation;

  return [
    "## Automated CI remediation resolved",
    "",
    "Taskblaster completed automated remediation for this Accepted Candidate.",
    "",
    "### Automation summary",
    `- Worker: ${output.result.worker}`,
    `- Summary: ${output.result.outcome.summary}`,
    ...formatMutationLines(mutation),
    ...formatStackedPullRequestLines(output.result.stackedPullRequest),
  ].join("\n");
}

export function buildHumanEscalationCommentBody(output: HumanEscalationOutput): string {
  const candidate = output.candidate;
  const failures = candidate.input.failures.map(formatFailure).join("\n");

  return [
    "## Human escalation required",
    "",
    "Automation exhausted the available CI remediation path.",
    "",
    "### Candidate context",
    `- Pull request: ${candidate.input.changeRequest.url}`,
    `- Title: ${candidate.input.changeRequest.title}`,
    `- Repository: ${candidate.input.repository.owner}/${candidate.input.repository.name}`,
    `- Head ref: ${candidate.input.changeRequest.headRef}`,
    `- Head SHA: ${candidate.input.changeRequest.headSha}`,
    `- Detected at: ${candidate.detectedAt}`,
    "",
    "### Failed checks",
    failures,
    "",
    "### Automation summary",
    `- Attempted workers: ${output.attemptedWorkers.join(" -> ")}`,
    `- Failure summary: ${output.failureSummary}`,
    "",
    "### Recommended next action",
    output.recommendedAction,
  ].join("\n");
}

function formatFailure(failure: HumanEscalationOutput["candidate"]["input"]["failures"][number]) {
  const details = failure.detailsUrl ? ` - ${failure.detailsUrl}` : "";

  return `- ${failure.name} (${failure.conclusion})${details}`;
}

function formatMutationLines(mutation: ProviderResolvedOutput["result"]["outcome"]["mutation"]) {
  if (!mutation) {
    return [];
  }

  return [
    `- Commit: ${mutation.commitSha}`,
    `- Changed files: ${mutation.changedFiles.join(", ")}`,
    `- Pushed: ${mutation.pushed ? "yes" : "no"}`,
  ];
}

function formatStackedPullRequestLines(
  pullRequest: ProviderResolvedOutput["result"]["stackedPullRequest"],
) {
  if (!pullRequest) {
    return [];
  }

  return [`- Stacked pull request: ${pullRequest.url}`];
}
