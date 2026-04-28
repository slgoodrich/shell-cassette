# shell-cassette

[![CI](https://github.com/slgoodrich/shell-cassette/actions/workflows/ci.yml/badge.svg)](https://github.com/slgoodrich/shell-cassette/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/shell-cassette.svg)](https://www.npmjs.com/package/shell-cassette)
[![Node.js](https://img.shields.io/node/v/shell-cassette.svg)](https://www.npmjs.com/package/shell-cassette)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Polly.js for shell commands. Record subprocess output once, replay deterministically forever. Credential redaction on by default, with `shell-cassette scan` as a pre-commit safety check.

> **Migrating from v0.3?** v0.4 ships breaking changes. See the [migration callout](#migrating-from-v03) below or [CHANGELOG](CHANGELOG.md#040---2026-xx-xx).

## Why

Tests that shell out are flaky in subtle ways. `git log` returns different output every commit. CI hits a registry that occasionally times out. `gh` and `aws` calls don't work on a plane. The CLI you're wrapping isn't installed on the CI image.

You're choosing between two bad options:

- **Run real subprocesses every test.** Slow, flaky, depends on your machine, doesn't work offline.
- **Hand-roll mocks.** Fast and deterministic, but you're guessing what the real subprocess returns. Mocks drift; the test passes when reality wouldn't.

shell-cassette is the third option: **real subprocess output captured once, replayed deterministically forever.** Real like a subprocess, fast like a mock. With 25 bundled credential patterns redacting on every record, plus `shell-cassette scan` to verify before commit.

What this unlocks:

- **Reproducible CI failures.** A test fails in CI; replay the exact recorded subprocess output locally. Debug the real failure, not "what would have happened with my git version on my OS."
- **Determinism.** Tests stop depending on system state, network, or upstream services.
- **Offline development.** Tests work on a plane, in a coffee shop, when GitHub is down.
- **Failure-path testing.** Hand-edit `exitCode: 137` in the cassette and watch your error handler run, every time.
- **Speed, as a side effect.** Cassette reads are milliseconds; real subprocesses are seconds. The multiplier scales with how heavy your subprocess work is. See [Real-world results](#real-world-results) for measurements on specific projects.
- **Credentials stay out of cassettes.** Bundled detection for GitHub, AWS, Stripe, OpenAI, Anthropic, Slack, npm, and 18 others. Verify with `npx shell-cassette scan` before every commit.

### Is this for you?

shell-cassette fits tests that **assert on subprocess output** (stdout, stderr, exit code, signal).

It is NOT for:

- Tests asserting on **which command was called** (`expect(execMock).toHaveBeenCalledWith(...)`). That's mock-for-assertion. Use `vi.mock` instead; that's a different problem and `vi.mock` is the right tool for it.
- Tests where the subprocess **mutates state** (creates a commit, installs packages, writes files) that non-mocked downstream code then reads. Replay returns recorded output but doesn't perform the mutation; downstream sees an unset-up state.

See [What this doesn't do](#what-this-doesnt-do) for the full incompatibility list.

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

Cassettes land at `__cassettes__/<test-file>/<test-name>.json`. Commit them.

## Adapters

shell-cassette ships drop-in replacements for two subprocess libraries:

- **[execa](docs/execa.md)** (`shell-cassette/execa`)
- **[tinyexec](docs/tinyexec.md)** (`shell-cassette/tinyexec`)

Each adapter has its own page covering supported options, replay limits, and any quirks.

If you use both, install both peer deps. shell-cassette's main entry exports only `useCassette` (the explicit-scope API) and shared types. Adapters live on sub-paths.

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

shell-cassette refuses to record without `SHELL_CASSETTE_ACK_REDACTION=true`. The ack gate forces a conscious "I know what gets redacted and what doesn't" decision before any cassette lands on disk. Recording is the only mode that requires it; replay needs nothing.

### Redacted by default

shell-cassette ships **25 bundled credential patterns**, applied to env values, args, stdout lines, stderr lines, and `allLines`. Each pattern is anchored, character-class-locked, and length-bounded by the issuer's published format:

- **GitHub** (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`)
- **AWS access key IDs** (`AKIA`, `ASIA`, `AROA`, `AIDA`, `AGPA`, `ANPA`, `ANVA`, `APKA`, `ABIA`, `ACCA`)
- **Stripe** (`sk_live_`, `sk_test_`, `rk_live_`, `rk_test_`)
- **OpenAI** (`sk-`, `sk-proj-`, `sk-svcacct-`, `sk-admin-`)
- **Anthropic** (`sk-ant-api03-`, `sk-ant-sid01-`, `sk-ant-admin01-`)
- **Google** (`AIza`)
- **Slack** (`xoxb-`, `xoxp-`, `xoxa-`, `xoxr-`, `xoxs-`, `xoxo-`, plus `https://hooks.slack.com/services/...` webhook URLs)
- **GitLab** (`glpat-`)
- **npm** (`npm_`)
- **DigitalOcean** (`dop_v1_`)
- **SendGrid** (`SG.<22>.<43>`)
- **Mailgun** (`key-<32 hex>`)
- **Hugging Face** (`hf_`)
- **PyPI** (`pypi-AgE`)
- **Discord** (three-segment base64 bot tokens)
- **Square** (`EAAA`)

Full reference table with provider docs in [docs/redact-patterns.md](docs/redact-patterns.md). Rule names are API-stable: locked at v0.4 and never renamed.

Each redaction replaces the credential with a counter-tagged placeholder: `<redacted:source:rule-name:N>`. The counter is per-cassette per (source, rule). Diff-friendly: re-recording a cassette with the same secrets produces identical placeholders.

### Redacted with config

- **Curated env keys.** Env values are redacted when the KEY contains `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD`, `APIKEY`, `API_KEY`, `CREDENTIAL`, `PRIVATE_KEY`, `AUTH_TOKEN`, `BEARER_TOKEN`, `JWT` (substring match, case-insensitive).
- **User-extended env keys.** Add your own to `Config.redact.envKeys` (substring match, same semantics).
- **Custom rules.** `Config.redact.customPatterns: RedactRule[]`. Project-specific shapes the bundle doesn't cover.
- **Suppress list.** `Config.redact.suppressPatterns: RegExp[]`. Values matching a suppress pattern are exempt from all rules and the long-value warning.

```ts
// shell-cassette.config.mjs
export default {
  redact: {
    envKeys: ['STRIPE_API_KEY', 'OPENAI_API_KEY'],
    customPatterns: [
      { name: 'my-internal-token', pattern: /MYINT-[A-Z0-9]{32}/ },
    ],
    suppressPatterns: [/^FAKE_/],
  },
}
```

### Not redacted (residual risks)

shell-cassette redacts what it can detect with 100% reliability and warns on suspicious-looking unredacted values. Some shapes can't be detected reliably:

- **AWS Secret Access Keys.** 40-char base64, no documented prefix. Caught by the long-value warning at length 40+ when the value isn't path-shaped. Add the env key to `redact.envKeys` if your tests carry one as an env var.
- **JWTs.** Many JWTs in the wild are public ID tokens or JWKS responses, not bearer secrets. Default-off; opt-in via a custom rule when your JWTs are bearer-shaped.
- **Encoded credentials.** `Authorization: Basic <base64>` headers, base64-encoded YAML/JSON secrets. shell-cassette doesn't decode. Add a custom rule if relevant.
- **Binary output.** `BinaryOutputError` blocks recording when the subprocess emits non-UTF-8.
- **`cwd` values.** Credentials in working-directory paths are vanishingly rare; not redacted.
- **Subprocess `stdin`.** Not captured in v0.4. v0.5 will capture stdin and apply the same pipeline.

Workarounds for each gap are in [docs/troubleshooting.md](docs/troubleshooting.md#residual-risks-and-gaps-in-v04-redaction).

### Long-value warnings

Values 40+ characters that did NOT match any rule emit a warning at record time. The warning is logged but the value is NOT redacted (shell-cassette can't pattern-match an unknown shape safely). The threshold (default 40) and a path heuristic (skip warning when the value contains `/`, `\`, `:`, or whitespace) are tunable via `Config.redact.warnLengthThreshold` and `Config.redact.warnPathHeuristic`.

End-of-run summaries make redaction events visible:

```
shell-cassette: cassette saved (3 recordings, 1 redaction, 2 warnings): /path/to/cassette.json
  redacted: GH_TOKEN
  warning: STRIPE_API_KEY: long value (104 chars), not in curated/configured list, may contain a credential...
```

Each cassette JSON also contains a top-level `_warning` field reminding reviewers to scan before committing.

## Pre-commit hook

The `shell-cassette scan` CLI walks cassette files (or directories) and reports any unredacted findings. Run it as a pre-commit hook to block credentials from ever landing in a commit.

**husky:**

```bash
# .husky/pre-commit
npx shell-cassette scan tests/__cassettes__/
```

**lefthook:**

```yaml
# lefthook.yml
pre-commit:
  commands:
    cassette-scan:
      run: npx shell-cassette scan tests/__cassettes__/
```

Exit codes:

- `0` - all cassettes clean, commit proceeds.
- `1` - at least one cassette has unredacted findings, commit is blocked.
- `2` - error (missing path, malformed cassette, conflicting flags).

When the hook blocks: review the listed findings, run `npx shell-cassette re-redact tests/__cassettes__/` to re-apply current rules, and commit again.

## CLI usage

shell-cassette ships a `shell-cassette` binary with two subcommands.

### `scan`

Read-only. Walks cassette paths and reports unredacted findings.

```bash
npx shell-cassette scan tests/__cassettes__/
npx shell-cassette scan path/to/single-cassette.json
npx shell-cassette scan --json tests/__cassettes__/   # structured output for tooling
npx shell-cassette scan --quiet tests/__cassettes__/  # exit code only
```

Common flags:

| Flag | Behavior |
|---|---|
| `--json` | Structured output (locked schema, `scanVersion: 1`). |
| `--quiet` | Suppress stdout; use the exit code only. |
| `--include-match` | With `--json`, include raw match values. UNSAFE for piping; use only for local debugging. |
| `--config <path>` | Override config discovery. |
| `--no-bundled` | Skip bundled patterns; check user rules and suppress list only. |
| `--no-color` / `--color=always` | Color override. |

Example output:

```
tests/__cassettes__/login.test.ts/test-1.json: 2 unredacted finding(s)
  [rec0-stdout-1:0-github-pat-classic]: ghp_aBcD1234... (40 chars)
  [rec0-env-GH_TOKEN:0-env-key-match]: ghp_aBcD1234... (40 chars)

1 cassette(s) scanned, 1 dirty, 0 error(s).
```

Exit `0` clean, `1` dirty, `2` error.

### `re-redact`

Re-applies the current redaction rules to existing cassettes. Idempotent: running twice yields identical output. Use this when the bundle expands or when you add a custom rule and want to upgrade existing cassettes.

```bash
npx shell-cassette re-redact tests/__cassettes__/
npx shell-cassette re-redact --dry-run tests/__cassettes__/   # preview
npx shell-cassette re-redact path/to/single-cassette.json
```

Existing placeholders are preserved; new findings get counters at `max(existing) + 1` per (source, rule). v1 cassettes are upgraded to v2 in place.

Common flags:

| Flag | Behavior |
|---|---|
| `--dry-run` | Preview changes without writing. |
| `--quiet` | Suppress stdout summary. |
| `--config <path>` | Override config discovery. |
| `--no-bundled` | Skip bundled patterns. |
| `--no-color` / `--color=always` | Color override. |

Exit `0` no new redactions, `1` at least one cassette modified (or would be in dry-run), `2` error.

### Ack-gate workflow

Recording requires `SHELL_CASSETTE_ACK_REDACTION=true`. Replay does not. Typical flow:

```bash
# First run, record cassettes
SHELL_CASSETTE_ACK_REDACTION=true npm test

# Verify before commit
npx shell-cassette scan tests/__cassettes__/

# Subsequent runs replay automatically
npm test

# CI forces replay-strict
npm test  # CI=true is set by your CI provider
```

Run `shell-cassette --help`, `shell-cassette scan --help`, and `shell-cassette re-redact --help` for the full flag list.

## Adapter quirks

A few v0.4 specifics worth knowing:

- **`shell-cassette/tinyexec` exports `exec` as an alias for `x`.** Mirrors tinyexec's own dual export so `import { exec } from 'tinyexec'` redirects to `import { exec } from 'shell-cassette/tinyexec'` without renaming.
- **`shell-cassette/tinyexec.xSync` throws.** Sync subprocess wrapping requires synchronous lazy-load support, planned for v0.5. Use async `x` (recommended), or import `xSync` directly from `tinyexec` (those calls bypass shell-cassette).
- **`result.process` on tinyexec replay throws** a clear `ShellCassetteError`. Tests reading `result.process.stdout` / `.stderr` / `.stdin` should switch to the buffered `result.stdout` / `result.stderr` fields, or run with `SHELL_CASSETTE_MODE=passthrough`.

See [docs/tinyexec.md](docs/tinyexec.md) for the full set of replay limits.

## Vite/Vitest plugin: redirecting bare imports

If your tests import `tinyexec` (or `execa`) bare and you don't want to rewrite every call site to `shell-cassette/tinyexec`, use the vite plugin to redirect imports at resolution time:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { shellCassetteAlias } from 'shell-cassette/vite-plugin'

export default defineConfig({
  plugins: [shellCassetteAlias({ adapters: ['tinyexec'] })],
  test: {
    setupFiles: ['shell-cassette/vitest'],
    server: { deps: { inline: ['shell-cassette'] } },
  },
})
```

The plugin redirects bare `tinyexec` imports from your test code to `shell-cassette/tinyexec`, but skips redirection when the importer is itself part of shell-cassette (so shell-cassette's internal `import 'tinyexec'` resolves to the real package). Without that guard, a naive `resolve.alias` self-loops.

`adapters` defaults to `['tinyexec']`. Pass `['execa']` or `['tinyexec', 'execa']` if you wrap the other library or both.

## Configuration

Optional `shell-cassette.config.{js,mjs}` walked up from cwd:

```js
import { basenameCommand, defaultCanonicalize } from 'shell-cassette'

export default {
  // Where cassettes live (default '__cassettes__', relative to test file)
  cassetteDir: '__cassettes__',

  redact: {
    // Bundled credential patterns (default: true). Set false to skip the bundle.
    bundledPatterns: true,

    // Extends the curated env-key match list (substring, case-insensitive).
    envKeys: ['STRIPE_API_KEY', 'OPENAI_API_KEY'],

    // Project-specific credential shapes the bundle doesn't cover.
    customPatterns: [
      { name: 'my-internal-token', pattern: /MYINT-[A-Z0-9]{32}/ },
    ],

    // Values matching any suppress pattern are exempt from all rules.
    suppressPatterns: [/^FAKE_/],

    // Long-value warning threshold (default 40 chars). Path heuristic skips
    // values containing `/`, `\`, `:`, or whitespace.
    warnLengthThreshold: 40,
    warnPathHeuristic: true,
  },

  // Custom canonicalize fn (default: defaultCanonicalize, command exact +
  // args with absolute mkdtemp paths normalized to <tmp>; cwd, env, stdin
  // omitted from the canonical form so cassettes are portable across machines)
  canonicalize: (call) => ({
    ...defaultCanonicalize(call),
    command: basenameCommand(call.command),  // /usr/bin/git matches git
  }),
}
```

Full reference for the redact config is in [docs/redact-patterns.md](docs/redact-patterns.md).

## Customizing matching

shell-cassette matches a call to a recording by deep-equality of their canonical forms. The default canonical form covers the common case (command + tmp-normalized args). For everything else, write a `canonicalize` function.

```ts
import { basenameCommand, defaultCanonicalize, useCassette } from 'shell-cassette'
import type { Canonicalize } from 'shell-cassette'

// Cross-machine command portability: /usr/bin/git matches git
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

The default canonicalize is conservative. These patterns are NOT normalized. Write a custom canonicalize if you hit one:

| Pattern | Workaround |
|---|---|
| Nested mkdtemp (mkdtemp inside an mkdtemp dir) | Custom canonicalize that strips the inner mkdtemp suffix |
| Relative tmp paths via `path.relative(cwd, tmpPath)` | Custom canonicalize that resolves to absolute first |
| Custom `$TMPDIR` outside the standard set (e.g., `/scratch/...`) | Compose your own pattern alongside `defaultCanonicalize` |
| `process.cwd()` substrings inside args | Custom canonicalize that replaces `call.cwd ?? ''` with a token |

## Migrating from v0.3

v0.4 ships breaking changes around redaction and the cassette schema. The full list lives in the [CHANGELOG](CHANGELOG.md#040---2026-xx-xx); the practical migration steps are:

1. **Update your config.** `Config.redactEnvKeys` moved under the new composed `Config.redact` shape:
   ```diff
   - export default { redactEnvKeys: ['STRIPE_API_KEY'] }
   + export default { redact: { envKeys: ['STRIPE_API_KEY'] } }
   ```
2. **Remove any direct calls to `redactEnv()`.** The function is removed. The recorder applies redaction transparently at record time; if you need ad-hoc redaction in your code, use the exported `redact()` instead.
3. **Upgrade existing cassettes.** v0.4 bumps the cassette schema from version 1 to version 2. v0.4 reads both; v0.3 readers reject v2. If you've already recorded under v0.3 and want v0.4's redaction applied to them in place:
   ```bash
   npx shell-cassette re-redact tests/__cassettes__/
   ```
   Idempotent; running twice yields identical output.
4. **Add the pre-commit hook.** v0.4 ships the `shell-cassette scan` CLI; wire it as a pre-commit hook (see [Pre-commit hook](#pre-commit-hook) above).
5. **Review residual gaps.** v0.4's bundle covers 25 credential shapes but does not cover AWS Secret Access Keys, JWTs, or encoded credentials. Check the [Not redacted (residual risks)](#not-redacted-residual-risks) section and [docs/troubleshooting.md](docs/troubleshooting.md#residual-risks-and-gaps-in-v04-redaction); add custom rules for project-specific shapes if needed.

Mixed-version teams should pin to v0.4 across the team. Cassettes recorded by v0.4 are not loadable by v0.3.

## Common gotchas

If you hit one of these, see [docs/troubleshooting.md](docs/troubleshooting.md):

- `VitestPluginRegistrationError` ("Vitest failed to find the runner") -> add `deps.inline: ['shell-cassette']`
- `MissingPeerDependencyError` -> install the runner peer dep (execa, tinyexec, or vitest)
- `NoActiveSessionError` -> in CI=true replay mode without a session bound; wrap with `useCassette` or import the vitest plugin
- `NoActiveSessionError` from `beforeAll` / `beforeEach` -> setup runs outside the per-test session; use real `tinyexec` / `execa` in setup, or `SHELL_CASSETTE_MODE=passthrough` for setup-only flows
- `AckRequiredError` with "auto mode: no recording matched..." -> matcher missed; check cassette
- `__cassettes__/` showing up as a test fixture -> exclude alongside `__snapshots__/`
- `vi.mock('tinyexec')` infinite loop -> redirect at the import level, or use `shellCassetteAlias` from `shell-cassette/vite-plugin`
- Naive `resolve.alias: { tinyexec: 'shell-cassette/tinyexec' }` self-loops -> use `shellCassetteAlias` instead (importer guard included)
- Test passes in record but fails in replay asserting on filesystem state -> shell-cassette captures subprocess I/O, not subprocess side effects; refactor to assert on stdout, or use `SHELL_CASSETTE_MODE=passthrough`
- "cassette path exceeds 240 chars" -> shorten describe / test names, shorten `cassetteDir`, or move test files closer to the project root

## What this doesn't do

Two patterns shell-cassette is not a fit for. 

**Mock-for-assertion patterns.** shell-cassette captures and replays subprocess **output**, not subprocess invocations. Tests that assert on **which command was called** (`expect(execMock).toHaveBeenCalledWith('git', ['commit', ...])`) are testing the wrong abstraction layer. Use `vi.mock` for that pattern; it's a different concern. Examples in the wild: `prettier/pretty-quick`, `antfu/ni`, `jinghaihan/pncat`.

**Subprocess as state mutator.** shell-cassette mocks subprocess **outputs** on replay; it does NOT actually re-execute the subprocess. Tests that use a subprocess to mutate state (`git commit` to make a real commit, `mkdir`/`touch` to create files, `npm install` to populate node_modules), then have downstream code that depends on that mutation, will fail in replay mode: setup is mocked, no real mutation happens, downstream sees an unset-up state. Two patterns to watch for:

- Setup uses wrapped `exec` for state changes; a non-wrapped library (or a `vi.mock` chain that calls real `actual.x`) reads the resulting state. The wrapped calls return mocked output but the state never changed. The unwrapped reads see the true (unmutated) state.
- A test branches on subprocess output (`if status === clean`) and the branch performs writes the next assertion depends on. Replay returns the recorded "clean" output but the writes that depended on a real subprocess having run never happen.

shell-cassette is for **output-assertion** tests: spawn a subprocess, capture stdout / exit code / signal, assert on it. For state orchestration where a real mutation has to happen, run those calls outside shell-cassette's scope (or in `passthrough` mode).

## Real-world results

Three projects measured so far on Windows + Node 23. Point measurements, not benchmarks: directional only.

| Project | Test execution speedup | Wall speedup | Notes |
|---|---:|---:|---|
| [cacjs/cac](https://github.com/cacjs/cac) | ~90x | ~4x | 17 tests, light subprocess (`node example.ts`) |
| [antfu/taze](https://github.com/antfu/taze) | ~200x | ~5x | 2 tests, medium subprocess (CLI with network fetch) |
| [import-js/eslint-import-resolver-typescript](https://github.com/import-js/eslint-import-resolver-typescript) | ~1700x | ~55x | 13 tests, heavy subprocess (`yarn eslint` per fixture) |

Wall-time speedup is bounded by vitest startup (~300-400ms regardless of mode). Test execution speedup scales with subprocess work per test: the heavier the subprocess, the bigger the multiplier.

## License

MIT, see `LICENSE`.
