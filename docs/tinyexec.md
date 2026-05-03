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
| `result.process` | Throws `ShellCassetteError` on read | No live `ChildProcess` to expose; the throwing getter surfaces a clear error rather than letting downstream `.stdout`/`.stderr`/`.stdin` accesses fail with confusing TypeErrors |
| `result.pipe(...)` | Throws `UnsupportedOptionError` | Pipe chaining requires a live subprocess to receive stdin |
| `result.kill()` | No-op | The subprocess never spawned; nothing to kill |
| `for await (line of result)` | Throws `UnsupportedOptionError` | Interleaving order between stdout and stderr is lost in storage |
| Synchronous reads of `proc.pid`, `proc.killed`, `proc.aborted` BEFORE `await` | Returns `undefined` | Replay returns `Promise<Result>`, not the live ProcessPromise shape |

**Workaround:** `await` the result first, then read fields on the resolved object. The validation targets (varlet-release, cac, eslint-import-resolver-typescript) all follow this pattern.

## Lossy mappings

The cassette schema is narrower than tinyexec's runtime result. One mapping still loses information:

- **`signal` (string vs boolean)**: tinyexec exposes `killed: boolean` but not the actual signal name. We unconditionally store `'SIGTERM'` on kill. The real signal name is lost.

`aborted` and `killed` are preserved through record/replay. Both fields live as getters on the pre-await `ExecProcess`; the adapter's `realCall` snapshots them before the `await` resolves so the cassette captures real values rather than `undefined` reads from the awaited `Output`.

## Failed flag

Tinyexec's `Output` does not expose a `failed` boolean. shell-cassette derives `failed` on capture from `exitCode !== 0 || killed || aborted` and stores it in the cassette. Replay surfaces the stored value; older cassettes recorded before the field was stored re-derive at replay time via the same formula. The `throwOnError` reject branch keys on the resolved value, so signal-killed and aborted replays throw under `throwOnError: true` even when the cassette predates the field.

## Supported tinyexec options

| Option | Status |
|---|---|
| `signal` (AbortSignal) | Supported, passed to real tinyexec on record |
| `timeout` | Supported, passed through |
| `nodeOptions` (with `cwd`, `env`, etc.) | Supported, options destructured into the cassette `Call` shape |
| `throwOnError` | Supported on record AND replay (synthesized error matches tinyexec's shape) |
| `stdin` (string) | Supported. Stored on `Call.stdin` and included in the match-tuple, so a call carrying stdin only matches a recording made with the same stdin. |
| `persist: true` | **Rejected** (subprocess outliving host can't replay) |
| `stdin: Result` (pipe chaining) | **Rejected** (chaining requires live process) |

Rejected options throw `UnsupportedOptionError` at the wrapper entry.

## Named exports

- **`x`** is the canonical entry point.
- **`exec`** is an alias for `x`. tinyexec exports both names; shell-cassette mirrors that so `import { exec } from 'tinyexec'` redirects to `import { exec } from 'shell-cassette/tinyexec'` without renaming at every call site.
- **`xSync`** is a stub that throws a clear error pointing to async `x`. Sync subprocess wrapping requires synchronous lazy-load support, which shell-cassette does not currently provide. Either refactor to async `x` (gets cassette coverage), or import `xSync` directly from `tinyexec` (those calls bypass shell-cassette).

## Redaction

By default, shell-cassette redacts:

- **Bundled credential patterns.** 25 prefix-anchored shapes applied to env values, args, stdin, stdout, stderr, and `allLines`. Reference: [docs/redact-patterns.md](redact-patterns.md).
- **Curated env-key values.** Whole-value redacted when the env-var KEY contains `TOKEN`, `SECRET`, `PASSWORD`, `APIKEY`, etc.
- **User-supplied custom rules** (`config.redact.customPatterns`) applied to the same six sources.

What is NOT redacted by default: AWS Secret Access Keys (no documented prefix), JWTs (opt-in), encoded credentials, `cwd` values, binary output. See [troubleshooting → Residual risks](troubleshooting.md#residual-risks-and-gaps-in-redaction). Always review cassettes before committing. `npx shell-cassette scan` reports what would be flagged.
