import {
  TRIAGE_CI_FAILURE_WORKFLOW,
  type ChangeRequestRef,
  type CiFailureConclusion,
  type CiFailureSignal,
  type Detector,
  type RepositoryRef,
  type TriageCiFailureCandidate,
} from "../../domain/index.ts";

export type GitLabPipelineStatus =
  | "canceled"
  | "created"
  | "failed"
  | "manual"
  | "pending"
  | "preparing"
  | "running"
  | "scheduled"
  | "skipped"
  | "success"
  | "waiting_for_resource";

export interface GitLabMergeRequest {
  readonly iid: number;
  readonly title: string;
  readonly web_url: string;
  readonly sha: string;
  readonly target_branch: string;
  readonly source_branch: string;
}

export interface GitLabPipeline {
  readonly id: number;
  readonly name?: string | null;
  readonly status: GitLabPipelineStatus;
  readonly web_url?: string;
}

export interface GitLabCiObservation {
  readonly repository: Omit<RepositoryRef, "provider">;
  readonly mergeRequest: GitLabMergeRequest;
  readonly observedAt: string;
  readonly pipelines: readonly GitLabPipeline[];
}

type FailedGitLabPipeline = GitLabPipeline & {
  readonly status: "canceled" | "failed";
};

export class GitLabCiFailureDetector
  implements Detector<GitLabCiObservation, TriageCiFailureCandidate>
{
  detect(observation: GitLabCiObservation): readonly TriageCiFailureCandidate[] {
    return detectGitLabCiFailures(observation);
  }
}

export function detectGitLabCiFailures(
  observation: GitLabCiObservation,
): readonly TriageCiFailureCandidate[] {
  const failures = observation.pipelines
    .filter(isFailedPipeline)
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
          provider: "gitlab",
          owner: observation.repository.owner,
          name: observation.repository.name,
        },
        changeRequest: toChangeRequestRef(observation.mergeRequest),
        failures,
      },
    },
  ];
}

function isFailedPipeline(pipeline: GitLabPipeline): pipeline is FailedGitLabPipeline {
  return pipeline.status === "failed" || pipeline.status === "canceled";
}

function toChangeRequestRef(mergeRequest: GitLabMergeRequest): ChangeRequestRef {
  return {
    number: mergeRequest.iid,
    title: mergeRequest.title,
    url: mergeRequest.web_url,
    headSha: mergeRequest.sha,
    baseRef: mergeRequest.target_branch,
    headRef: mergeRequest.source_branch,
  };
}

function toCiFailureSignal(pipeline: FailedGitLabPipeline): CiFailureSignal {
  const signal = {
    provider: "gitlab",
    externalId: String(pipeline.id),
    name: pipeline.name ?? `pipeline ${pipeline.id}`,
    conclusion: toCiFailureConclusion(pipeline.status),
  };

  if (pipeline.web_url === undefined) {
    return signal;
  }

  return {
    ...signal,
    detailsUrl: pipeline.web_url,
  };
}

function toCiFailureConclusion(status: FailedGitLabPipeline["status"]): CiFailureConclusion {
  return status === "canceled" ? "cancelled" : "failure";
}
