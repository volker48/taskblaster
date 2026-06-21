import {
  TRIAGE_CI_FAILURE_WORKFLOW,
  type ChangeRequestRef,
  type CiFailureConclusion,
  type CiFailureSignal,
  type Detector,
  type RepositoryRef,
  type TriageCiFailureCandidate,
} from "../../domain/index.ts";

export type GitHubCheckConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "skipped"
  | "startup_failure"
  | "success"
  | "timed_out";

export type GitHubCheckStatus =
  | "completed"
  | "in_progress"
  | "pending"
  | "queued"
  | "requested"
  | "waiting";

export interface GitHubCheckRun {
  readonly id: number;
  readonly name: string;
  readonly status: GitHubCheckStatus;
  readonly conclusion: GitHubCheckConclusion | null;
  readonly detailsUrl?: string;
}

export interface GitHubCiObservation {
  readonly repository: Omit<RepositoryRef, "provider">;
  readonly pullRequest: ChangeRequestRef;
  readonly observedAt: string;
  readonly checkRuns: readonly GitHubCheckRun[];
}

type FailedGitHubCheckRun = GitHubCheckRun & {
  readonly conclusion: CiFailureConclusion;
  readonly status: "completed";
};

export class GitHubCiFailureDetector
  implements Detector<GitHubCiObservation, TriageCiFailureCandidate>
{
  detect(observation: GitHubCiObservation): readonly TriageCiFailureCandidate[] {
    return detectGitHubCiFailures(observation);
  }
}

export function detectGitHubCiFailures(
  observation: GitHubCiObservation,
): readonly TriageCiFailureCandidate[] {
  const failures = observation.checkRuns
    .filter(isFailedCheckRun)
    .map(toCiFailureSignal);

  if (failures.length === 0) {
    return [];
  }

  return [
    {
      workflowName: TRIAGE_CI_FAILURE_WORKFLOW,
      detectedAt: observation.observedAt,
      input: {
        repository: {
          provider: "github",
          owner: observation.repository.owner,
          name: observation.repository.name,
        },
        changeRequest: observation.pullRequest,
        failures,
      },
    },
  ];
}

function isFailedCheckRun(
  checkRun: GitHubCheckRun,
): checkRun is FailedGitHubCheckRun {
  return checkRun.status === "completed" && isFailureConclusion(checkRun.conclusion);
}

function isFailureConclusion(
  conclusion: GitHubCheckConclusion | null,
): conclusion is CiFailureConclusion {
  return (
    conclusion === "action_required" ||
    conclusion === "cancelled" ||
    conclusion === "failure" ||
    conclusion === "startup_failure" ||
    conclusion === "timed_out"
  );
}

function toCiFailureSignal(checkRun: FailedGitHubCheckRun): CiFailureSignal {
  const signal = {
    provider: "github",
    externalId: String(checkRun.id),
    name: checkRun.name,
    conclusion: checkRun.conclusion,
  };

  if (checkRun.detailsUrl === undefined) {
    return signal;
  }

  return {
    ...signal,
    detailsUrl: checkRun.detailsUrl,
  };
}
