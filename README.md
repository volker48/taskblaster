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

## Test

Run the test suite:

```bash
pnpm test
```

Run the TypeScript checker:

```bash
pnpm tsc --noEmit
```
