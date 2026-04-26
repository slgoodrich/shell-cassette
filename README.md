# shell-cassette

[![CI](https://github.com/slgoodrich/shell-cassette/actions/workflows/ci.yml/badge.svg)](https://github.com/slgoodrich/shell-cassette/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/shell-cassette.svg)](https://www.npmjs.com/package/shell-cassette)
[![Node.js](https://img.shields.io/node/v/shell-cassette.svg)](https://www.npmjs.com/package/shell-cassette)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Polly.js, but for shell commands. Record subprocess calls once, replay them deterministically forever.

## Why

Testing code that spawns subprocesses today means picking between three bad options: hit the real binary (slow, flaky, environment-dependent), hand-roll mocks (tedious, drifts from reality), or skip testing the boundary (where bugs come from).

shell-cassette records subprocess calls once and replays them deterministically. Your tests go from minutes to seconds without losing fidelity to real subprocess behavior.

## Installation

```bash
npm install --save-dev shell-cassette
```

Peer dependencies:

- `execa` ^9 — required
- `vitest` ^4 — optional (only needed if you use the vitest plugin)

Install whichever you don't already have.

## Quick start

```ts
// vitest.setup.ts
import 'shell-cassette/vitest'
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts']
  }
})
```

```ts
// my-test.test.ts
import { test, expect } from 'vitest'
import { execa } from 'shell-cassette/execa'

test('finds current branch', async () => {
  const { stdout } = await execa('git', ['branch', '--show-current'])
  expect(stdout).toBe('main')
})
```

First run (record):

```bash
SHELL_CASSETTE_ACK_REDACTION=true npm test
```

Subsequent runs (auto-replay):

```bash
npm test
```

CI:

```bash
npm test  # CI=true forces replay-strict
```

By default, cassettes land next to the test file at `__cassettes__/<test-file>/<test-name>.json`. Commit them — they're how replay works on the next run and in CI.

## Recording mode

| Mode | Behavior |
|---|---|
| `passthrough` (default outside cassette scope) | Calls real execa, no recording |
| `auto` (default inside cassette scope) | Replays if recording exists, records if not (auto-additive) |
| `record` | Always records (overwrites unmatched recordings) |
| `replay` | Replays only; throws on missing |

Set via `SHELL_CASSETTE_MODE=record|replay|passthrough`. `CI=true` forces `replay`.

## Security: redaction

shell-cassette refuses to record without `SHELL_CASSETTE_ACK_REDACTION=true`.

By default, env var values are redacted when KEY contains:
`TOKEN`, `SECRET`, `PASSWORD`, `PASSWD`, `APIKEY`, `API_KEY`, `CREDENTIAL`, `PRIVATE_KEY`, `AUTH_TOKEN`, `BEARER_TOKEN`, `JWT`.

shell-cassette does NOT redact:

- stdout/stderr content
- command args
- env vars with non-curated names (e.g., `STRIPE_KEY`, `OPENAI_KEY`)
- paths in cwd

**Always review cassettes before committing.**

## Configuration

Optional `shell-cassette.config.{js,mjs}`:

```js
// shell-cassette.config.js
export default {
  cassetteDir: '__cassettes__',         // default
  redactEnvKeys: ['STRIPE_KEY'],        // adds to curated list
  // Custom matcher: match on command only, ignore args (default matches command + deep-equal args).
  matcher: (call, rec) => call.command === rec.call.command,
}
```

## Explicit cassette scope

For non-vitest contexts or `test.concurrent`:

```ts
import { useCassette } from 'shell-cassette'
import { execa } from 'shell-cassette/execa'

test.concurrent('parallel test', async () => {
  await useCassette('./cassettes/parallel.json', async () => {
    await execa('git', ['status'])
  })
})
```

## What v0.1 doesn't do (yet)

- Multiple subprocess libraries (tinyexec, nano-spawn) — v0.2
- Streaming output (`buffer: false`) — v1.0
- IPC channels (`ipc: true`) — v1.0
- stdin support — v0.2 (buffered) / v1.0 (file)
- Bun.spawn / Deno.Command / native child_process — v1.0
- CLI tools (`shell-cassette show`, `prune`, etc.) — v0.2
- Stdout/stderr/args content redaction — v0.2

## License

MIT — see `LICENSE`.
