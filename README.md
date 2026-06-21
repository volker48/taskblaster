# Agent Orchestration Framework

This repository contains a TypeScript framework for deterministic maintenance
loops with model-backed routing and workers.

## Requirements

- Node.js 22.19.0 or newer
- pnpm 11.8.0

## Setup

Before installing dependencies, configure pnpm's install safety settings:

```bash
pnpm config set minimumReleaseAge 1440
pnpm config set ignore-scripts true
```

Install dependencies from the lockfile:

```bash
pnpm install --frozen-lockfile
```

## Runtime Targets

Taskblaster names Runtime Targets separately from Loop vocabulary:

- `local`: runs `pnpm loop:local -- <payload.json>` against a supplied
  `triage-ci-failure` candidate payload. This path does not call GitHub, does
  not call a model provider, and does not mutate pull request state.
- `node`: runs `pnpm flue:run:triage-ci-failure` through the Flue Node target.
  This is the model-backed runtime path used for workflow discovery and Flue
  execution.

The Node Runtime Target expects secrets from environment variables:

- `GITHUB_TOKEN`: GitHub API access for provider reads and dependency-gated
  write paths.
- `FLUE_API_KEY`: Flue runtime access.
- `OPENAI_API_KEY`: model provider access for routing and worker sessions.

Do not commit these values. Set them in the operator shell, local secret store,
or deployment secret manager.

Run the local dry-run fixture:

```bash
pnpm loop:local -- fixtures/triage-ci-failure-candidate.json
```

Run the Flue Node target:

```bash
GITHUB_TOKEN=... FLUE_API_KEY=... OPENAI_API_KEY=... pnpm flue:run:triage-ci-failure
```

## CI/MR Loop Operator Guide

The first Loop is `triage-ci-failure`. A Scheduler starts the Loop on a time or
event trigger, then a deterministic Detector admits provider observations only
when an open change request has completed failed checks. Passing, pending,
queued, and in-progress checks do not become candidate work.

Accepted candidates enter the `triage-ci-failure` Workflow. The Router classifies
the candidate Difficulty as `cheap` or `deep`, then selects either
`cheap_ci_worker` or `deep_ci_worker`. Worker profile names are validated before
routing so missing mappings fail the Loop instead of failing during Repair
Mutation.

Repair Mutations are the changes a Worker proposes or applies to resolve the CI
failure:

- Low-risk formatter and linter repairs are expected to use direct branch
  mutation when a branch mutation driver is configured.
- Extensive or risky deep-worker repairs are represented as stacked pull request
  requests when a stacked pull request creator is configured.
- The current local Runtime Target is a dry run and never calls GitHub or mutates
  provider state.
- The current Loop runner supports Mutation Caps for limiting concurrent Repair
  Mutations, but it does not yet wire a stacked pull request creator through the
  batch Loop path. Treat stacked pull request creation as dependency-gated work.

Escalation is finite. An unresolved cheap Worker result escalates to
`deep_ci_worker`. An unresolved deep Worker result escalates to a human. When a
human escalation publisher is configured, the GitHub adapter can publish a pull
request comment with the failed checks, attempted Workers, and recommended next
action.

The Workflow result reports one of these operator outcomes:

- `no_candidate`: nothing actionable was admitted.
- `completed`: the Workflow ran for a candidate and returned `resolved`,
  `escalated`, or Workflow-level `no_candidate`.
- `capped`: the Mutation Cap was exhausted before starting a Repair Mutation.
- `failed`: Loop configuration was invalid, such as missing Worker profiles or
  invalid Mutation Cap values.

### GitHub Permissions

Use the least-privileged token that supports the configured Runtime Target:

- Reading checks and pull request metadata requires pull request and check read
  access for the target repository.
- Direct branch Repair Mutations require permission to write contents to the pull
  request branch. This is dependency-gated and not used by the local dry run.
- Opening stacked pull requests requires branch creation plus pull request write
  access. This is dependency-gated until the stacked pull request creator is wired
  into the running target.
- Publishing human escalation comments requires issue or pull request comment
  write access.

### Candidate Fixture

Use the committed fixture to exercise the local path without credentials:

```bash
pnpm loop:local -- fixtures/triage-ci-failure-candidate.json
```

The dry-run workers do not repair the fixture. The expected terminal result is
human Escalation after `cheap_ci_worker` and `deep_ci_worker` both report
unresolved outcomes.

The fixture shape is:

```json
{
  "workflowName": "triage-ci-failure",
  "detectedAt": "2026-06-20T14:00:00.000Z",
  "input": {
    "repository": {
      "provider": "github",
      "owner": "acme",
      "name": "widgets"
    },
    "changeRequest": {
      "number": 42,
      "title": "Fix lint",
      "url": "https://example.test/acme/widgets/pull/42",
      "headSha": "abc123",
      "baseRef": "main",
      "headRef": "fix-lint"
    },
    "failures": [
      {
        "provider": "github",
        "externalId": "check-1",
        "name": "lint",
        "conclusion": "failure"
      }
    ]
  }
}
```

## Test

Run the test suite:

```bash
pnpm test
```

Run the TypeScript checker:

```bash
pnpm tsc --noEmit
```
