import { TRIAGE_CI_FAILURE_WORKFLOW, type TriageCiFailureCandidate } from "./domain/index.ts";

type WorkflowNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): {
    fetch(request: Request): Promise<Response>;
  };
};

export type CloudflareScheduledTriageEnv = {
  readonly TASKBLASTER_ACCEPTED_CANDIDATES_JSON?: string;
  readonly FLUE_TRIAGE_CI_FAILURE_WORKFLOW?: WorkflowNamespace;
};

export type CloudflareScheduledTriageResult = {
  readonly candidate: TriageCiFailureCandidate;
  readonly status: number;
  readonly ok: boolean;
};

export default {
  async scheduled(
    _controller: unknown,
    env: CloudflareScheduledTriageEnv,
  ): Promise<readonly CloudflareScheduledTriageResult[]> {
    return runCloudflareScheduledTriage(env);
  },
};

export async function runCloudflareScheduledTriage(
  env: CloudflareScheduledTriageEnv,
): Promise<readonly CloudflareScheduledTriageResult[]> {
  const candidates = parseAcceptedCandidates(env.TASKBLASTER_ACCEPTED_CANDIDATES_JSON);

  if (candidates.length === 0) {
    return [];
  }

  if (!env.FLUE_TRIAGE_CI_FAILURE_WORKFLOW) {
    throw new Error("Missing Cloudflare binding: FLUE_TRIAGE_CI_FAILURE_WORKFLOW.");
  }

  return Promise.all(
    candidates.map((candidate) =>
      dispatchCloudflareWorkflow(env.FLUE_TRIAGE_CI_FAILURE_WORKFLOW!, candidate),
    ),
  );
}

export function parseAcceptedCandidates(
  raw: string | undefined,
): readonly TriageCiFailureCandidate[] {
  if (!raw?.trim()) {
    return [];
  }

  const parsed = JSON.parse(raw) as TriageCiFailureCandidate | readonly TriageCiFailureCandidate[];

  if (Array.isArray(parsed)) {
    return parsed as readonly TriageCiFailureCandidate[];
  }

  return [parsed as TriageCiFailureCandidate];
}

function dispatchCloudflareWorkflow(
  workflow: WorkflowNamespace,
  candidate: TriageCiFailureCandidate,
): Promise<CloudflareScheduledTriageResult> {
  const id = workflow.idFromName(buildWorkflowInstanceName(candidate));
  const request = new Request(
    `https://taskblaster.internal/workflows/${TRIAGE_CI_FAILURE_WORKFLOW}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(candidate),
    },
  );

  return workflow
    .get(id)
    .fetch(request)
    .then((response) => ({
      candidate,
      status: response.status,
      ok: response.ok,
    }));
}

function buildWorkflowInstanceName(candidate: TriageCiFailureCandidate): string {
  const repository = candidate.input.repository;
  const changeRequest = candidate.input.changeRequest;

  return [
    repository.provider,
    repository.owner,
    repository.name,
    String(changeRequest.number),
    changeRequest.headSha,
  ].join(":");
}
