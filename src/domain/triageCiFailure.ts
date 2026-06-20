import type { WorkflowName } from "./orchestration";

export const TRIAGE_CI_FAILURE_WORKFLOW = "triage-ci-failure" satisfies WorkflowName;

export interface RepositoryRef {
  readonly provider: string;
  readonly owner: string;
  readonly name: string;
}

export interface ChangeRequestRef {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly headRef: string;
}

export type CiFailureConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "startup_failure"
  | "timed_out";

export interface CiFailureSignal {
  readonly provider: string;
  readonly externalId: string;
  readonly name: string;
  readonly conclusion: CiFailureConclusion;
  readonly detailsUrl?: string;
}

export interface TriageCiFailureInput {
  readonly repository: RepositoryRef;
  readonly changeRequest: ChangeRequestRef;
  readonly failures: readonly CiFailureSignal[];
}

export interface TriageCiFailureCandidate {
  readonly workflowName: typeof TRIAGE_CI_FAILURE_WORKFLOW;
  readonly input: TriageCiFailureInput;
  readonly detectedAt: string;
}
