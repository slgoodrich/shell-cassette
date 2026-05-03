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
| `lines: true` | Supported. Boolean form returns `string[]` from stdout/stderr; object form (`{ stdout, stderr, all, fd1, fd2 }`) toggles per-stream array vs. string output |
| `all: true` | Supported (merged stdout+stderr in `result.all`) |
| `reject: false` | Supported on both record and replay |
| `input: 'string'` | Supported. Buffered stdin is stored on `Call.stdin` and included in the match-tuple. Non-string `input` (Uint8Array, Readable) is rejected. |
| `inputFile` | Supported. The file is read by shell-cassette before the matcher runs, stored on `Call.stdin`, and included in the match-tuple. Non-UTF-8 input throws `BinaryInputError`. |
| `node: true` | Supported. Routed to real `execaNode` on record; the `node` flag is not stored in the cassette so recordings made via `node: true` and `execaNode(...)` are interchangeable. |
| `execaNode(file, args, options)` (named export) | Supported. Equivalent to `execa(file, args, { ...options, node: true })`. |
| `buffer: false` | **Rejected** (streaming) |
| `ipc: true` | **Rejected** (IPC channels) |

Rejected options throw `UnsupportedOptionError` at the record-mode wrapper entry.

## Replay fidelity

When the wrapper synthesizes a result on replay, it populates every documented `Result` boolean flag so user assertions reach reachable values:

| Field | Replay value |
|---|---|
| `failed` | Stored on capture; if absent (older cassettes), derived from `exitCode !== 0 \|\| signal !== null \|\| aborted` |
| `timedOut` | Stored on capture; defaults to `false` when absent |
| `isCanceled` | Mirrors the cassette's `aborted` field |
| `isMaxBuffer` | Stored on capture; defaults to `false` when absent |
| `isTerminated` | Derived: `signal !== null` |
| `isForcefullyTerminated` | Stored on capture; defaults to `false` when absent |
| `isGracefullyCanceled` | Stored on capture; defaults to `false` when absent |
| `killed` | Stored on capture from execa's `r.killed`; if absent (older cassettes), derived from `signal !== null` |
| `pipedFrom` | Always `[]` (`.pipe()` is stubbed; see below) |
| `ipcOutput` | Always `[]` (`ipc: true` is rejected at validation) |

Other fields (`stdout`, `stderr`, `exitCode`, `signal`, `command`, `escapedCommand`, `durationMs`, optional `all`) round-trip as before. The reject branch throws synthesized `ExecaError` when the resolved `failed` is `true` and `reject !== false` (matching execa's default). The fallback derivations let cassettes recorded before the `failed` and `killed` fields were stored auto-upgrade their replay correctness; aborted and signal-killed calls throw on replay even when the cassette predates the flag.

`durationMs` is wall-clock measured by shell-cassette's wrapper around the real subprocess.

### Subprocess-API methods on replay

The synth result attaches a minimal subprocess API:

| Method | Replay behavior |
|---|---|
| `kill(signal?)` | No-op; returns `false` (real execa returns `false` when no signal was sent) |
| `pipe(...)` | Throws `UnsupportedOptionError`; use `SHELL_CASSETTE_MODE=passthrough` for tests that pipe |
| `for await (line of subprocess)` | Throws `UnsupportedOptionError`; read `result.stdout` (string or `lines: true` array) |

Stream methods (`iterable()`, `readable()`, `writable()`, `duplex()`) and stream-property getters (`stdin`, `stdout`, `stderr` as Node streams) are not stubbed; calls produce `TypeError`. Tests using these patterns must run with `SHELL_CASSETTE_MODE=passthrough`.

## Redaction

By default, shell-cassette redacts:

- **Bundled credential patterns.** 25 prefix-anchored shapes (GitHub, AWS access key IDs, Stripe, OpenAI, Anthropic, Slack, npm, etc.) applied to env values, args, stdin, stdout, stderr, and `allLines`. Reference: [docs/redact-patterns.md](redact-patterns.md).
- **Curated env-key values.** Whole-value redacted when the env-var KEY contains `TOKEN`, `SECRET`, `PASSWORD`, `APIKEY`, etc. (substring match, case-insensitive).
- **User-supplied custom rules** (`config.redact.customPatterns`) applied to the same six sources.

What is NOT redacted by default: AWS Secret Access Keys (no documented prefix), JWTs (opt-in via custom rule), encoded credentials (`Authorization: Basic ...`), `cwd` values, binary output (blocked by `BinaryOutputError`). See [troubleshooting → Residual risks](troubleshooting.md#residual-risks-and-gaps-in-redaction). Always review cassettes before committing. `npx shell-cassette scan` reports what would be flagged.
