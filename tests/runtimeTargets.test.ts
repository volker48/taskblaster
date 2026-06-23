import { describe, expect, it } from "vitest";
import {
  DEFAULT_MUTATION_CAP,
  getRuntimeTargetConfig,
  validateRuntimeTargetSecrets,
} from "../src/runtimeTargets";

describe("Runtime Target configuration", () => {
  it("names local, Node, and Cloudflare targets with explicit command paths", () => {
    expect(getRuntimeTargetConfig("local")).toMatchObject({
      name: "local",
      command: "pnpm loop:local -- <payload.json>",
      scheduler: "manual",
      mutatesProvider: false,
      defaultMutationCap: DEFAULT_MUTATION_CAP,
      requiredSecrets: [],
    });
    expect(getRuntimeTargetConfig("node")).toMatchObject({
      name: "node",
      command: "pnpm flue:run:triage-ci-failure",
      scheduler: "daemon",
      mutatesProvider: false,
      defaultMutationCap: DEFAULT_MUTATION_CAP,
      requiredSecrets: ["GITHUB_TOKEN", "FLUE_API_KEY", "OPENAI_API_KEY"],
    });
    expect(getRuntimeTargetConfig("cloudflare")).toMatchObject({
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
    });
  });

  it("reports unset or blank Runtime Target secrets", () => {
    const config = getRuntimeTargetConfig("cloudflare");

    expect(
      validateRuntimeTargetSecrets(config, {
        GITHUB_TOKEN: "github-token",
        OPENAI_API_KEY: "",
        CLOUDFLARE_API_TOKEN: "cloudflare-token",
      }),
    ).toEqual(["OPENAI_API_KEY", "CLOUDFLARE_ACCOUNT_ID"]);
  });
});
