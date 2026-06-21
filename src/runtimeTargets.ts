export type RuntimeTargetName = "local" | "node";

export type RuntimeSecretName =
  | "GITHUB_TOKEN"
  | "FLUE_API_KEY"
  | "OPENAI_API_KEY";

export type RuntimeTargetConfig = {
  readonly name: RuntimeTargetName;
  readonly command: string;
  readonly mutatesProvider: boolean;
  readonly requiredSecrets: readonly RuntimeSecretName[];
};

export const RUNTIME_TARGETS = {
  local: {
    name: "local",
    command: "pnpm loop:local -- <payload.json>",
    mutatesProvider: false,
    requiredSecrets: [],
  },
  node: {
    name: "node",
    command: "pnpm flue:run:triage-ci-failure",
    mutatesProvider: false,
    requiredSecrets: ["GITHUB_TOKEN", "FLUE_API_KEY", "OPENAI_API_KEY"],
  },
} as const satisfies Record<RuntimeTargetName, RuntimeTargetConfig>;

export function getRuntimeTargetConfig(
  name: RuntimeTargetName,
): RuntimeTargetConfig {
  return RUNTIME_TARGETS[name];
}

export function validateRuntimeTargetSecrets(
  config: RuntimeTargetConfig,
  env: Record<string, string | undefined>,
): readonly RuntimeSecretName[] {
  return config.requiredSecrets.filter((secret) => !env[secret]?.trim());
}
