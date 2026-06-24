# Agent Orchestration Framework

This context defines the language for a framework that combines deterministic
automation with model-backed workers for repository maintenance loops.

## Language

**Loop**:
A recurring automation that observes external state, decides whether work is
needed, and drives that work to a terminal outcome.
_Avoid_: Agent, automation

**Scheduler**:
A deterministic component that starts a loop on a time or event trigger.
_Avoid_: Cron agent, polling agent

**Detector**:
A deterministic component that decides whether observed external state contains
candidate work.
_Avoid_: Triage agent, checker

**Workflow**:
A finite unit of work with a known input, result, and completion boundary.
_Avoid_: Job, agent

**Router**:
A model-assisted component that classifies candidate work by expected
difficulty. It does not choose a worker; the Escalation Ladder does.
_Avoid_: Dispatcher, orchestrator

**Escalation Ladder**:
A deterministic ordered chain of workers. The classified difficulty selects the
entry rung; an unresolved attempt climbs to the next rung; climbing past the top
rung escalates to a human.
_Avoid_: Pipeline, chain of responsibility

**Worker**:
A model-backed or deterministic component that attempts a selected remediation.
_Avoid_: Agent, fixer

**Difficulty**:
The expected reasoning and change complexity of a remediation, as inferred from
pipeline failures, comments, and related context.
_Avoid_: Priority, severity

**Escalation**:
Moving unresolved work to a more capable worker or to a human when available
workers are exhausted.
_Avoid_: Retry, fallback
