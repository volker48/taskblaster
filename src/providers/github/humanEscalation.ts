import type { HumanEscalationOutput } from "../../loops/triageCiFailure.ts";

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
