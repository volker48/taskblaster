import { defineConfig } from "@flue/cli/config";

const target = process.env.FLUE_TARGET === "cloudflare" ? "cloudflare" : "node";

export default defineConfig({
  target,
});
