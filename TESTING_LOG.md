# Testing Log

## 2026-06-20

- Cloned `/Users/marcusmccurdy/code/taskblaster` to
  `/tmp/taskblaster-readme-test`.
- Found that the clean clone did not contain `README.md`, so there were no
  README-only setup or test instructions to follow.
- Confirmed project requirements from `package.json`: Node.js `>=22.19.0` and
  pnpm `11.8.0`.
- Set pnpm safety options before installing dependencies:
  `pnpm config set minimumReleaseAge 1440` and
  `pnpm config set ignore-scripts true`.
- Installed dependencies in the clean clone with
  `pnpm install --frozen-lockfile`.
- Verified tests pass in the clean clone with `pnpm test`: 1 test file passed,
  2 tests passed.
- Verified TypeScript passes in the clean clone with `pnpm tsc --noEmit`.
- Created a second fresh clone at `/tmp/taskblaster-readme-verify`, added the
  candidate `README.md`, and followed the README commands in order.
- Verified the README setup and test path in that second clone:
  `pnpm install --frozen-lockfile`, `pnpm test`, and `pnpm tsc --noEmit` all
  passed.
- Subagent Euclid created another `/tmp` verification checkout at
  `/tmp/taskblaster-readme-verify.rRU0mT` using the current uncommitted
  `README.md`.
- Subagent Euclid verified the README commands all passed:
  `pnpm config set minimumReleaseAge 1440`,
  `pnpm config set ignore-scripts true`, `pnpm install --frozen-lockfile`,
  `pnpm test`, and `pnpm tsc --noEmit`.
- Subagent Euclid noted that the first sandboxed install attempt hit npm
  registry DNS failures (`ENOTFOUND`), then the same README install command
  passed after approved network access.
