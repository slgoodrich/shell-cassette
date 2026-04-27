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
        inline: ['shell-cassette'],   // required for vitest 4.x
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

**Always review cassettes before committing.** Pattern-based detection for stdout/stderr/args (GitHub PATs, AWS keys, Stripe keys, etc.) isn't built yet - review by eye.

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
import { basenameCommand, defaultCanonicalize } from 'shell-cassette'

export default {
  // Where cassettes live (default '__cassettes__', relative to test file)
  cassetteDir: '__cassettes__',

  // Adds to the curated env-key redaction list (substring, case-insensitive)
  redactEnvKeys: ['STRIPE_API_KEY', 'OPENAI_API_KEY'],

  // Custom canonicalize fn (default: defaultCanonicalize — command exact +
  // args with absolute mkdtemp paths normalized to <tmp>; cwd, env, stdin
  // omitted from the canonical form so cassettes are portable across machines)
  canonicalize: (call) => ({
    ...defaultCanonicalize(call),
    command: basenameCommand(call.command),  // /usr/bin/git matches git
  }),
}
```

## Customizing matching

shell-cassette matches a call to a recording by deep-equality of their canonical forms. The default canonical form covers the common case (command + tmp-normalized args). For everything else, write a `canonicalize` function.

```ts
import { basenameCommand, defaultCanonicalize, useCassette } from 'shell-cassette'
import type { Canonicalize } from 'shell-cassette'

// Cross-machine command portability — /usr/bin/git matches git
const basenameMatching: Canonicalize = (call) => ({
  ...defaultCanonicalize(call),
  command: basenameCommand(call.command),
})

// Ignore version numbers in args (e.g. `npm publish --tag v1.2.3`)
const ignoreVersions: Canonicalize = (call) => {
  const c = defaultCanonicalize(call)
  return { ...c, args: c.args!.map((a) => a.replace(/v\d+\.\d+\.\d+/, '<v>')) }
}

// Order-insensitive args (`--flag-a --flag-b` matches `--flag-b --flag-a`)
const sortedArgs: Canonicalize = (call) => ({
  command: call.command,
  args: [...call.args].sort(),
})
```

Apply per-call via `useCassette`'s optional middle argument:

```ts
useCassette('./cassettes/foo.json', { canonicalize: basenameMatching }, async () => {
  await execa('git', ['status'])
})
```

Or globally via `shell-cassette.config.js` (see Configuration above).

### Documented limitations

The default canonicalize is conservative. Patterns NOT normalized — write a custom canonicalize if you hit one:

| Pattern | Workaround |
|---|---|
| Nested mkdtemp (mkdtemp inside an mkdtemp dir) | Custom canonicalize that strips the inner mkdtemp suffix |
| Relative tmp paths via `path.relative(cwd, tmpPath)` | Custom canonicalize that resolves to absolute first |
| Custom `$TMPDIR` outside the standard set (e.g., `/scratch/...`) | Compose your own pattern alongside `defaultCanonicalize` |
| `process.cwd()` substrings inside args | Custom canonicalize that replaces `call.cwd ?? ''` with a token |

## Common gotchas

If you hit one of these, see [docs/troubleshooting.md](docs/troubleshooting.md):

- `VitestPluginRegistrationError` ("Vitest failed to find the runner") → add `deps.inline: ['shell-cassette']`
- `MissingPeerDependencyError` → install the runner peer dep (execa, tinyexec, or vitest)
- `NoActiveSessionError` → in CI=true replay mode without a session bound; wrap with `useCassette` or import the vitest plugin
- `AckRequiredError` with "auto mode: no recording matched..." → matcher missed; check cassette
- `__cassettes__/` showing up as a test fixture → exclude alongside `__snapshots__/`
- `vi.mock('tinyexec')` infinite loop → redirect at the import level instead

## What this doesn't do (yet)

If you're evaluating shell-cassette for your project, here are some things you might run into.

**Adapter feature parity.** shell-cassette doesn't wrap every option of execa or tinyexec.

- execa: `buffer: false` (streaming), `ipc: true` (IPC), `inputFile` / `input: 'string'` (stdin), `node: true` (execaNode) all throw `UnsupportedOptionError` at the wrapper. See [docs/execa.md](docs/execa.md).
- tinyexec: `result.process` is `null` on replay, `result.pipe()` and `for await (line of result)` throw, `result.kill()` is a no-op, sync field reads before `await` return undefined. The exact signal name on `kill` is lost (only `killed: boolean` preserved). See [docs/tinyexec.md](docs/tinyexec.md).

**Matcher coverage.** The default canonicalize handles the common case: command + args with absolute mkdtemp paths normalized to `<tmp>`. cwd, env, and stdin are excluded from the canonical form so cassettes replay across machines. Patterns it does NOT handle (nested mkdtemp, relative tmp paths, custom `$TMPDIR`, `process.cwd()` substrings in args) are documented under [Customizing matching](#customizing-matching) with one-line workarounds.

**Redaction coverage.** shell-cassette redacts env-var values when KEY matches a curated list. It does NOT redact:

- stdout / stderr content
- command args (`--token=ghp_xxx`)
- env vars whose KEY isn't in the curated list (extend via `redactEnvKeys` config)
- paths in cwd

There's no pattern-based detection for tokens / API keys in stdout, stderr, or args. Review cassettes before committing.

**Other runners and frameworks.** Only execa and tinyexec are wrapped today. No Bun.spawn, no Deno.Command, no native `child_process`, no nano-spawn. Only vitest is plumbed as a plugin - no jest, mocha, or `node:test` plugin.

**Tooling.** No CLI for inspecting / pruning / reviewing cassettes (`shell-cassette show`, `shell-cassette prune`, etc.). The cassette JSON is human-readable; for now you read and edit by hand.

**Subprocess as state mutator.** shell-cassette mocks subprocess **outputs** on replay; it does NOT actually re-execute the subprocess. Tests that use a subprocess to mutate state (`git commit` to make a real commit, `mkdir`/`touch` to create files, `npm install` to populate node_modules), then have downstream code that depends on that mutation, will fail in replay mode: setup is mocked, no real mutation happens, downstream sees an unset-up state. Two patterns to watch for:

- Setup uses wrapped `exec` for state changes; a non-wrapped library (or a `vi.mock` chain that calls real `actual.x`) reads the resulting state. The wrapped calls return mocked output but the state never changed. The unwrapped reads see the true (unmutated) state.
- A test branches on subprocess output (`if status === clean`) and the branch performs writes the next assertion depends on. Replay returns the recorded "clean" output but the writes that depended on a real subprocess having run never happen.

shell-cassette is for **output-assertion** tests: spawn a subprocess, capture stdout / exit code / signal, assert on it. For state orchestration where a real mutation has to happen, run those calls outside shell-cassette's scope (or in `passthrough` mode).

## Real-world results

| Project | Test execution speedup | Wall speedup | Notes |
|---|---:|---:|---|
| [cacjs/cac](https://github.com/cacjs/cac) | ~88x | ~4x | 17 tests, drop-in integration |
| [import-js/eslint-import-resolver-typescript](https://github.com/import-js/eslint-import-resolver-typescript) | ~373x | ~55x | 15 tests, heavy `yarn eslint` per fixture |

Wall-time speedup is bounded by vitest startup (~300-400ms regardless of mode). Test execution speedup scales with subprocess work per test.

## License

MIT - see `LICENSE`.
