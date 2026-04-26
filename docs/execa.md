# execa adapter

Drop-in replacement for [`execa`](https://github.com/sindresorhus/execa) that records subprocess calls once and replays them on subsequent runs.

## Setup

```bash
npm install --save-dev shell-cassette execa
```

`execa` is an optional peer dep - install it only if you use this adapter. Same for `vitest` if you use the auto-cassette plugin.

## Usage

### With the vitest plugin (auto-cassette per test)

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
        inline: ['shell-cassette'],
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

The plugin registers a `beforeEach`/`afterEach` pair that scopes each test to its own cassette under `__cassettes__/<test-file>/<test-name>.json`.

If `deps.inline` is missing, you'll see `VitestPluginRegistrationError` at test startup - see [troubleshooting](troubleshooting.md#vitestpluginregistrationerror-vitest-failed-to-find-the-runner).

### With explicit `useCassette` (non-vitest, or `test.concurrent`)

```ts
import { useCassette } from 'shell-cassette'
import { execa } from 'shell-cassette/execa'

test.concurrent('parallel test', async () => {
  await useCassette('./cassettes/parallel.json', async () => {
    await execa('git', ['status'])
  })
})
```

Each call to `useCassette` opens a scope; calls to `execa` inside the scope record/replay against the named cassette.

## Recording and replaying

First run (record):

```bash
SHELL_CASSETTE_ACK_REDACTION=true npm test
```

Subsequent runs (replay automatically from cassettes):

```bash
npm test
```

CI:

```bash
npm test  # CI=true forces replay-strict
```

The ack gate is required only on record. Replay needs nothing.

## Mode reference

| Mode | Behavior |
|---|---|
| `passthrough` | Calls real execa, no recording. Default outside a cassette scope. |
| `auto` | Replays if recording exists; records if not. Default inside a scope. |
| `record` | Always records (overwrites unmatched recordings). |
| `replay` | Replays only; throws on miss. Forced by `CI=true`. |

Set via `SHELL_CASSETTE_MODE=record|replay|passthrough|auto`.

## Supported execa options

execa's options pass through to the wrapped call. shell-cassette validates them at record time and rejects ones that don't replay correctly:

| Option | Status |
|---|---|
| `cwd`, `env`, `timeout`, `signal`, `argv0`, `cleanup`, etc. | Supported, passed to real execa on record, captured in cassette where relevant |
| `lines: true` | Supported (returns `string[]` from stdout/stderr) |
| `all: true` | Supported (merged stdout+stderr in `result.all`) |
| `reject: false` | Supported on both record and replay |
| `buffer: false` | **Rejected** (streaming) |
| `ipc: true` | **Rejected** (IPC channels) |
| `inputFile` | **Rejected** (stdin from file) |
| `input: 'string'` | **Rejected** (buffered stdin) |
| `node: true` | **Rejected** (execaNode) |

Rejected options throw `UnsupportedOptionError` at the record-mode wrapper entry. They're tracked in the [backlog](https://github.com/slgoodrich/shell-cassette).

## Replay fidelity

When the wrapper synthesizes a result on replay, it produces the same shape execa returns:

- `stdout`, `stderr`, `exitCode`, `signal`, `command`, `escapedCommand`, `failed`, `timedOut`, `isCanceled`, `killed`, `durationMs`
- `all` (when `all: true` was passed)
- Throws synthesized `ExecaError` when exit code is non-zero AND `reject: false` not set (matching execa's default)

`isCanceled` is preserved through record/replay (captured from execa's field, stored as `aborted` in the cassette schema, synthesized back to `isCanceled` on replay). `durationMs` is wall-clock measured around the real subprocess by shell-cassette's wrapper, uniform across runners.

## What's NOT redacted

shell-cassette only redacts curated env-key values by default. **stdout, stderr, args, and non-curated env vars are not scrubbed.** See [troubleshooting → What shell-cassette does NOT redact](troubleshooting.md#what-shell-cassette-does-not-redact). Always review cassettes before committing.
