import { describe, expect, it } from "vitest";
import {
  getRuntimeTargetConfig,
  validateRuntimeTargetSecrets,
} from "../src/runtimeTargets";

describe("Runtime Target configuration", () => {
  it("names local and Node targets with explicit command paths", () => {
    expect(getRuntimeTargetConfig("local")).toMatchObject({
      name: "local",
      command: "pnpm loop:local -- <payload.json>",
      mutatesProvider: false,
      requiredSecrets: [],
    });
    expect(getRuntimeTargetConfig("node")).toMatchObject({
      name: "node",
      command: "pnpm flue:run:triage-ci-failure",
      mutatesProvider: false,
      requiredSecrets: ["GITHUB_TOKEN", "FLUE_API_KEY", "OPENAI_API_KEY"],
    });
  });

  it("reports unset or blank Runtime Target secrets", () => {
    const config = getRuntimeTargetConfig("node");

    expect(
      validateRuntimeTargetSecrets(config, {
        GITHUB_TOKEN: "github-token",
        FLUE_API_KEY: "",
      }),
    ).toEqual(["FLUE_API_KEY", "OPENAI_API_KEY"]);
  });
});
