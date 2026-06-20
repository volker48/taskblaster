export type WorkflowName = "triage-ci-failure";

export type Difficulty = "cheap" | "deep";

export interface Scheduler<Trigger> {
  start(trigger: Trigger): Promise<void>;
}

export interface Detector<Observation, Candidate> {
  detect(observation: Observation): readonly Candidate[];
}

export interface Workflow<Input, Result> {
  readonly name: WorkflowName;
  run(input: Input): Promise<Result>;
}

export interface RouteDecision<WorkerId extends string> {
  readonly workerId: WorkerId;
  readonly difficulty: Difficulty;
}

export interface Router<Candidate, WorkerId extends string> {
  route(candidate: Candidate): Promise<RouteDecision<WorkerId>>;
}

export interface Worker<Input, Result> {
  attempt(input: Input): Promise<Result>;
}

export type Escalation<WorkerId extends string> =
  | {
      readonly target: "worker";
      readonly workerId: WorkerId;
      readonly reason: string;
    }
  | {
      readonly target: "human";
      readonly reason: string;
    };
