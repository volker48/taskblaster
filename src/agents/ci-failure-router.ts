import { createAgent, defineAgentProfile } from "@flue/runtime";
import { local } from "@flue/runtime/node";

const cheapCiWorker = defineAgentProfile({
  name: "cheap_ci_worker",
  model: "openai/gpt-5.4-mini",
  description: "Handles simple CI remediation such as formatting or lint fixes.",
  instructions: [
    "You fix low-risk CI failures directly.",
    "Prefer formatter, linter, and configuration fixes with small diffs.",
    "Return unresolved when the failure needs semantic reasoning or broad changes.",
  ].join("\n"),
});

const deepCiWorker = defineAgentProfile({
  name: "deep_ci_worker",
  model: "openai/gpt-5.5",
  description: "Handles complex CI failures and correctness-risk review comments.",
  instructions: [
    "You fix complex CI failures that require careful reasoning.",
    "Use a separate branch or stacked change when the fix is extensive.",
    "Escalate for human review when automated remediation is not trustworthy.",
  ].join("\n"),
});

export default createAgent(() => ({
  model: "openai/gpt-5.5",
  sandbox: local(),
  instructions: [
    "Route CI failure candidates to the cheapest worker that can fix them safely.",
    "Classify formatter, linter, and obvious style failures as cheap.",
    "Classify race conditions, flaky tests, and semantic bugs as deep.",
    "Prefer deterministic evidence from pipeline failures over speculation.",
  ].join("\n"),
  subagents: [cheapCiWorker, deepCiWorker],
}));
