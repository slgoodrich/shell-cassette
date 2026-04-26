# tinyexec adapter

Drop-in replacement for [`tinyexec`](https://github.com/tinylibs/tinyexec)'s `x()` function.

## Setup

```bash
npm install --save-dev shell-cassette tinyexec
```

`tinyexec` is an optional peer dep - install it only if you use this adapter. Same for `vitest`.

## Usage

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
import { x } from 'shell-cassette/tinyexec'

test('captures git output', async () => {
  const r = await x('git', ['branch', '--show-current'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout.trim()).toBe('main')
})
```

If `deps.inline` is missing, you'll see `VitestPluginRegistrationError` - see [troubleshooting](troubleshooting.md#vitestpluginregistrationerror-vitest-failed-to-find-the-runner).

## Differences from execa

tinyexec's API differs from execa in ways the adapter has to handle:

| Concern | execa | tinyexec |
|---|---|---|
| **Default behavior on non-zero exit** | Throws (`reject: true` default) | **Does NOT throw**; check `result.exitCode` |
| **Error escape hatch** | `reject: false` to suppress throw | `throwOnError: true` to opt INTO throwing |
| **`cwd` and `env`** | Top-level options | Inside `nodeOptions: { cwd, env }` |
| **`lines: true` (stdout as array)** | Supported | No equivalent; use `for await (line of proc)` for live iteration |
| **`all: true` (merged stdout+stderr)** | Supported | No equivalent |

The adapter mirrors all of this. If your real-tinyexec code didn't throw on `process.exit(1)`, the replay synthesis won't either. If you set `throwOnError: true`, replay throws on non-zero exit.

## Replay limitations

tinyexec returns a richer object than `Promise<Result>` - it's structurally `PromiseLike<Output> & ProcessApi`. shell-cassette can't fully synthesize that on replay. The following interactions are not supported on replay:

| Interaction | Replay behavior | Reason |
|---|---|---|
| `result.process` | `null` | No live `ChildProcess` to expose |
| `result.pipe(...)` | Throws `UnsupportedOptionError` | Pipe chaining requires a live subprocess to receive stdin |
| `result.kill()` | No-op | The subprocess never spawned; nothing to kill |
| `for await (line of result)` | Throws `UnsupportedOptionError` | Interleaving order between stdout and stderr is lost in storage |
| Synchronous reads of `proc.pid`, `proc.killed`, `proc.aborted` BEFORE `await` | Returns `undefined` | Replay returns `Promise<Result>`, not the live ProcessPromise shape |

**Workaround:** `await` the result first, then read fields on the resolved object. All v0.2 validation targets (varlet-release, cac, eslint-import-resolver-typescript) follow this pattern, so it's the common case.

## Lossy mappings

The cassette schema is narrower than tinyexec's runtime result. One mapping still loses information:

- **`signal` (string vs boolean)**: tinyexec exposes `killed: boolean` but not the actual signal name. We unconditionally store `'SIGTERM'` on kill. The real signal name is lost.

`aborted` is preserved through record/replay since v0.2 (captured from tinyexec's `aborted: true` when AbortSignal triggered, synthesized back to `aborted` on replay).

## Supported tinyexec options

| Option | Status |
|---|---|
| `signal` (AbortSignal) | Supported, passed to real tinyexec on record |
| `timeout` | Supported, passed through |
| `nodeOptions` (with `cwd`, `env`, etc.) | Supported, options destructured into the cassette `Call` shape |
| `throwOnError` | Supported on record AND replay (synthesized error matches tinyexec's shape) |
| `stdin` (string) | Accepted, not stored in cassette in v0.2 (record-only) |
| `persist: true` | **Rejected** (subprocess outliving host can't replay) |
| `stdin: Result` (pipe chaining) | **Rejected** (chaining requires live process) |

Rejected options throw `UnsupportedOptionError` at the wrapper entry.

## What's NOT redacted

shell-cassette only redacts curated env-key values. stdout, stderr, args, and non-curated env vars are not scrubbed. See [troubleshooting → What shell-cassette does NOT redact](troubleshooting.md#what-shell-cassette-does-not-redact). Always review cassettes before committing.
