export const DEFAULT_MUTATION_CAP = 5;

export type RuntimeTargetName = "local" | "node" | "cloudflare";

export type RuntimeSecretName =
  | "GITHUB_TOKEN"
  | "FLUE_API_KEY"
  | "OPENAI_API_KEY"
  | "CLOUDFLARE_API_TOKEN"
  | "CLOUDFLARE_ACCOUNT_ID";

export type RuntimeTargetConfig = {
  readonly name: RuntimeTargetName;
  readonly command: string;
  readonly scheduler: "manual" | "daemon" | "cloudflare-cron";
  readonly mutatesProvider: boolean;
  readonly defaultMutationCap: number;
  readonly requiredSecrets: readonly RuntimeSecretName[];
};

export const RUNTIME_TARGETS = {
  local: {
    name: "local",
    command: "pnpm loop:local -- <payload.json>",
    scheduler: "manual",
    mutatesProvider: false,
    defaultMutationCap: DEFAULT_MUTATION_CAP,
    requiredSecrets: [],
  },
  node: {
    name: "node",
    command: "pnpm flue:run:triage-ci-failure",
    scheduler: "daemon",
    mutatesProvider: false,
    defaultMutationCap: DEFAULT_MUTATION_CAP,
    requiredSecrets: ["GITHUB_TOKEN", "FLUE_API_KEY", "OPENAI_API_KEY"],
  },
  cloudflare: {
    name: "cloudflare",
    command: "pnpm flue:build:cloudflare",
    scheduler: "cloudflare-cron",
    mutatesProvider: true,
    defaultMutationCap: DEFAULT_MUTATION_CAP,
    requiredSecrets: [
      "GITHUB_TOKEN",
      "OPENAI_API_KEY",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
    ],
  },
} as const satisfies Record<RuntimeTargetName, RuntimeTargetConfig>;

export function getRuntimeTargetConfig(name: RuntimeTargetName): RuntimeTargetConfig {
  return RUNTIME_TARGETS[name];
}

export function validateRuntimeTargetSecrets(
  config: RuntimeTargetConfig,
  env: Record<string, string | undefined>,
): readonly RuntimeSecretName[] {
  return config.requiredSecrets.filter((secret) => !env[secret]?.trim());
}
