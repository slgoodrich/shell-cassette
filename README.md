# shell-cassette

[![CI](https://github.com/slgoodrich/shell-cassette/actions/workflows/ci.yml/badge.svg)](https://github.com/slgoodrich/shell-cassette/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/shell-cassette.svg)](https://www.npmjs.com/package/shell-cassette)
[![Node.js](https://img.shields.io/node/v/shell-cassette.svg)](https://www.npmjs.com/package/shell-cassette)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Polly.js, but for shell commands. Record subprocess calls once, replay them deterministically forever.

## Why

Tests that shell out are flaky in subtle ways. `git log` returns different output every commit. CI runs `npm publish --dry-run` against a registry that occasionally times out. `gh` and `aws` calls don't work on a plane. The CLI you're wrapping isn't installed on the CI image.

shell-cassette records subprocess calls once and replays them deterministically. The output is whatever the real subprocess produced when you recorded - frozen, committed to your repo, replayed on every test run thereafter.

What this unlocks:

- **Reproducible CI failures.** A test fails in CI; replay the exact recorded subprocess outputs locally. Debug the real failure, not "what would have happened with my git version on my OS."
- **Determinism.** Tests stop depending on system state, network, or upstream services.
- **Offline development.** Tests work on a plane, in a coffee shop, when GitHub is down.
- **Failure-path testing.** Hand-edit a cassette to set `exitCode: 137` and watch your error handling run, every time.
- **Speed, as a side effect.** [88x faster on cac](https://github.com/slgoodrich/shell-cassette#real-world-results), 373x on heavier suites, by replacing real subprocess spawns with cassette reads.

## Migrating from v0.1

If you're upgrading from v0.1, the execa adapter moved to a sub-path:

```diff
- import { execa } from 'shell-cassette'
+ import { execa } from 'shell-cassette/execa'
```

Both `execa` and the new `tinyexec` peer dep are now optional - install only what you use. (This callout will be removed in v0.3.)

## Install

```bash
npm install --save-dev shell-cassette
```

Then install whichever runner peer dep you use:

```bash
npm install execa       # for shell-cassette/execa
# or
npm install tinyexec    # for shell-cassette/tinyexec
```

`vitest` is also an optional peer dep, only needed if you use the auto-cassette plugin.

## Quick start

Three pieces: setup file, vitest config, and your test.

```ts
// tests/sc-setup.ts
import 'shell-cassette/vitest'
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./tests/sc-setup.ts'],
    server: {
      deps: {
        inline: ['shell-cassette'],   // required for vitest 3.x and 4.x
      },
    },
  },
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

Subsequent runs (replay automatically):

```bash
npm test
```

CI:

```bash
npm test  # CI=true forces replay-strict
```

Cassettes land at `__cassettes__/<test-file>/<test-name>.json` - commit them.

## Adapters

shell-cassette ships drop-in replacements for two subprocess libraries:

- **[execa](docs/execa.md)** (`shell-cassette/execa`)
- **[tinyexec](docs/tinyexec.md)** (`shell-cassette/tinyexec`)

Each adapter has its own page covering supported options, replay limits, and any quirks.

If you use both, install both peer deps. shell-cassette's main entry exports only `useCassette` (the explicit-scope API) and shared types - adapters live on sub-paths.

## Auto-cassette via the vitest plugin

The setup snippet above hooks `shell-cassette/vitest`'s auto-cassette plugin into your test runner. One cassette per test, derived from the test's name. See the [vitest plugin guide](docs/vitest-plugin.md) for compatibility notes (`deps.inline` requirement, `vi.mock` interactions, `test.concurrent` handling).

## Explicit cassette scope

For non-vitest contexts, or `test.concurrent`, or whenever you want fine-grained control:

```ts
import { useCassette } from 'shell-cassette'
import { execa } from 'shell-cassette/execa'

test.concurrent('parallel test', async () => {
  await useCassette('./cassettes/parallel.json', async () => {
    await execa('git', ['status'])
  })
})
```

Each `useCassette` call opens a scope; subprocess calls inside record/replay against the named cassette. AsyncLocalStorage isolates concurrent scopes correctly.

## Recording mode

| Mode | Behavior |
|---|---|
| `passthrough` (default outside a cassette scope) | Calls real subprocess, no recording |
| `auto` (default inside a scope) | Replays if recording exists, records if not |
| `record` | Always records (overwrites unmatched recordings) |
| `replay` | Replays only; throws on miss |

Set via `SHELL_CASSETTE_MODE=record|replay|passthrough|auto`. `CI=true` forces `replay`.

## Security: redaction

shell-cassette refuses to record without `SHELL_CASSETTE_ACK_REDACTION=true`. The ack gate forces a conscious "I know what gets redacted and what doesn't" decision before any cassette lands on disk.

By default, env var values are redacted when KEY contains: `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD`, `APIKEY`, `API_KEY`, `CREDENTIAL`, `PRIVATE_KEY`, `AUTH_TOKEN`, `BEARER_TOKEN`, `JWT`. Substring match, case-insensitive.

shell-cassette does **NOT** redact:

- stdout / stderr content
- command args
- env vars with non-curated names (`STRIPE_KEY`, `OPENAI_KEY`, etc. - extend via `redactEnvKeys` config)
- paths in cwd

**Always review cassettes before committing.** v0.3 ships pattern-based detection for stdout/stderr/args (GitHub PATs, AWS keys, Stripe keys, etc.). Until then: review.

End-of-run summaries surface redaction events on every record:

```
shell-cassette: cassette saved (3 recordings, 1 redaction, 2 warnings): /path/to/cassette.json
  redacted: GH_TOKEN
  ⚠️  STRIPE_API_KEY: long value (104 chars), not in curated/configured list - may contain a credential...
```

Each cassette JSON also contains a `_warning` field reminding code reviewers to check before committing.

## Configuration

Optional `shell-cassette.config.{js,mjs}` walked up from cwd:

```js
export default {
  // Where cassettes live (default '__cassettes__', relative to test file)
  cassetteDir: '__cassettes__',

  // Adds to the curated env-key redaction list (substring, case-insensitive)
  redactEnvKeys: ['STRIPE_API_KEY', 'OPENAI_API_KEY'],

  // Custom matcher (default: command + deep-equal args)
  matcher: (call, rec) => call.command === rec.call.command,
}
```

## Common gotchas

If you hit one of these, see [docs/troubleshooting.md](docs/troubleshooting.md):

- `VitestPluginRegistrationError` ("Vitest failed to find the runner") → add `deps.inline: ['shell-cassette']`
- `MissingPeerDependencyError` → install the runner peer dep (execa, tinyexec, or vitest)
- `NoActiveSessionError` → in CI=true replay mode without a session bound; wrap with `useCassette` or import the vitest plugin
- `AckRequiredError` with "auto mode: no recording matched..." → matcher missed; check cassette
- `__cassettes__/` showing up as a test fixture → exclude alongside `__snapshots__/`
- `vi.mock('tinyexec')` infinite loop → redirect at the import level instead

## What this doesn't do

Tracked in the [project backlog](https://github.com/slgoodrich/shell-cassette/issues). No version pins - items get pulled when signal arrives.

- Streaming output (`buffer: false`)
- IPC channels (`ipc: true`)
- stdin support (buffered or streaming)
- Bun.spawn / Deno.Command / native child_process adapters
- jest plugin (vitest is the v0.2 plugin)
- CLI tools (`shell-cassette show`, `prune`, `review`, etc.)
- Pattern-based stdout/stderr/args redaction (v0.3 redact track)
- Per-call matcher override / path-normalization for ephemeral temp dirs (v0.3 matcher track)

## Real-world results

| Project | Test execution speedup | Wall speedup | Notes |
|---|---:|---:|---|
| [cacjs/cac](https://github.com/cacjs/cac) | ~88x | ~4x | 17 tests, drop-in integration |
| [import-js/eslint-import-resolver-typescript](https://github.com/import-js/eslint-import-resolver-typescript) | ~373x | ~55x | 15 tests, heavy `yarn eslint` per fixture |

Wall-time speedup is bounded by vitest startup (~300-400ms regardless of mode). Test execution speedup scales with subprocess work per test.

## Status

v0.2 - tinyexec adapter shipping. Stable enough for solo and small-team use. Format won't break before v1.0.

v0.3 will ship matcher flexibility (per-call overrides, path-normalization for ephemeral paths) and redact infrastructure (pattern-based detection, stable rule-tagged placeholders, stdout/stderr scrubbing). Both as the "team-ready foundation."

## License

MIT - see `LICENSE`.
