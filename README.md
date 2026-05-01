# shell-cassette

[![CI](https://github.com/slgoodrich/shell-cassette/actions/workflows/ci.yml/badge.svg)](https://github.com/slgoodrich/shell-cassette/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/shell-cassette.svg)](https://www.npmjs.com/package/shell-cassette)
[![Node.js](https://img.shields.io/node/v/shell-cassette.svg)](https://www.npmjs.com/package/shell-cassette)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Snapshot testing for subprocess output. Run your tests with real CLIs once; cassettes capture stdout, stderr, and exit codes. Replay is fast, deterministic, and works without the CLI installed.
>
> Built for libraries that wrap a CLI and assert on its output: package-manager wrappers, gh and oclif extensions, deploy-CLI wrappers, git tooling.

## Why

Three problems, depending on the CLI you wrap:

- **Wrapping a network CLI** (gh, deploy CLIs, package managers that hit a registry)? No API calls in tests. No rate limits. No credentials in CI.
- **Wrapping a local CLI** (git, basic POSIX, language toolchains)? Subprocess spawn cost eliminated. Test loops run at memory speed.
- **CLI not in your default CI image** (Docker, kubectl, terraform)? Replay works without the binary installed.

Without shell-cassette, you're picking among three painful options:

- **Run real subprocesses every test.** Slow. Flaky for network-dependent CLIs. Depends on the wrapped binary being installed and credentialed in CI.
- **Hand-roll fixtures.** Fast and deterministic, but the fixtures drift from the wrapped CLI's actual behavior. Tests pass while reality wouldn't.
- **`vi.mock` the runner and assert on call shape.** Brittle. Tests pass when the wrapper invokes the right command, but the wrapped CLI changed its actual output.

shell-cassette captures real subprocess output once and replays it deterministically forever. Real like a subprocess, fast like a mock.

What this unlocks:

- **Reproducible CI failures.** A test fails in CI; replay the exact recorded subprocess output locally. Debug the real failure, not "what would have happened with my git version on my OS."
- **Determinism.** Tests stop depending on system state, network, or upstream services.
- **Offline development.** Tests work on a plane, in a coffee shop, when GitHub is down.
- **Failure-path testing.** Hand-edit `exitCode: 137` in the cassette and watch your error handler run, every time.
- **Speed, as a side effect.** Cassette reads are milliseconds; real subprocesses are seconds. The multiplier scales with how heavy your subprocess work is. See [Real-world results](#real-world-results) for measurements on specific projects.
- **Credentials stay out of cassettes.** Bundled detection for GitHub, AWS, Stripe, OpenAI, Anthropic, Slack, npm, and 18 others. Verify with `npx shell-cassette scan` before every commit.

### Is this for you?

shell-cassette fits tests that treat subprocess output as a contract: invoke the CLI, capture stdout/stderr/exit code, assert on it.

It is NOT for tests that:

- **Use the subprocess as a state mutator** (filesystem changes, db writes, IPC) that downstream tests inherit. Replay returns recorded output but doesn't perform the mutation; downstream sees an unset-up state.
- **Read `result.stdout`/`result.stderr` as live streams synchronously.** shell-cassette captures buffered output, not stream events.
- **Use `vi.mock` to assert on call shape** (`expect(execMock).toHaveBeenCalledWith(...)`). That's testing the wrapper's invocation, not the wrapped CLI's behavior. Use `vi.mock` for that pattern.
- **Pipe-chain subprocesses** via `.pipe()` mid-execution. Replay can't recreate live pipe semantics.

See [What this doesn't do](#what-this-doesnt-do) for examples and workarounds.

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

Cassettes are written to `__cassettes__/<test-file>/<test-name>.json`. Commit them.

## Adapters

shell-cassette provides drop-in replacements for two subprocess libraries:

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

shell-cassette refuses to record without `SHELL_CASSETTE_ACK_REDACTION=true`. The ack gate forces a conscious "I know what gets redacted and what doesn't" decision before any cassette is written to disk. Recording is the only mode that requires it; replay needs nothing.

### Redacted by default

shell-cassette provides **25 bundled credential patterns**, applied to env values, args, stdout lines, stderr lines, and `allLines`. Each pattern is anchored, character-class-locked, and length-bounded by the issuer's published format:

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

Full reference table with provider docs in [docs/redact-patterns.md](docs/redact-patterns.md).

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

shell-cassette redacts what it can detect reliably and warns on suspicious-looking unredacted values. Some shapes can't be detected reliably:

- **AWS Secret Access Keys.** 40-char base64, no documented prefix. Caught by the long-value warning at length 40+ when the value isn't path-shaped. Add the env key to `redact.envKeys` if your tests carry one as an env var.
- **JWTs.** Many JWTs in the wild are public ID tokens or JWKS responses, not bearer secrets. Default-off; opt-in via a custom rule when your JWTs are bearer-shaped.
- **Encoded credentials.** `Authorization: Basic <base64>` headers, base64-encoded YAML/JSON secrets. shell-cassette doesn't decode. Add a custom rule if relevant.
- **Binary output.** `BinaryOutputError` blocks recording when the subprocess emits non-UTF-8.
- **`cwd` values.** Credentials in working-directory paths are vanishingly rare; not redacted.
- **Subprocess `stdin`.** Captured and redacted via the same pipeline as args/stdout/stderr (bundled patterns, custom rules, suppress list). The bundle catches well-shaped credentials passed on stdin; the same residual gaps above (AWS Secret Access Keys, JWTs, encoded credentials) apply.

Workarounds for each gap are in [docs/troubleshooting.md](docs/troubleshooting.md#residual-risks-and-gaps-in-redaction).

### Long-value warnings

Values 40+ characters that did NOT match any rule emit a warning at record time. The warning is logged but the value is NOT redacted (shell-cassette can't pattern-match an unknown shape safely). The pipeline strips ANSI escape sequences before measuring length (so a 30-char colored banner is not flagged as a 60-char candidate). The threshold (default 40) and a path heuristic (skip warning when the value contains `/`, `\`, `:`, or whitespace) are tunable via `Config.redact.warnLengthThreshold` and `Config.redact.warnPathHeuristic`. A curated list of env-var keys (`PATHEXT`, `WSLENV`, `__INTELLIJ_COMMAND_HISTFILE__`, `PSMODULEPATH`, `SHELL_SESSION_HISTFILE`) skip the warning by default; extend via `Config.redact.suppressLengthWarningKeys`.

End-of-run summaries make redaction events visible:

```
shell-cassette: cassette saved (3 recordings, 1 redaction, 2 warnings): /path/to/cassette.json
  redacted: GH_TOKEN
  warning: STRIPE_API_KEY: long value (104 chars), not in curated/configured list, may contain a credential...
```

Each cassette JSON also contains a top-level `_warning` field reminding reviewers to scan before committing.

## Pre-commit hook

The `shell-cassette scan` CLI walks cassette files (or directories) and reports any unredacted findings. Run it as a pre-commit hook to block credentials from ever ending up in a commit.

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

shell-cassette includes a `shell-cassette` binary with five subcommands. Two write to cassettes (`re-redact`, `prune`), one walks them interactively (`review`), two are read-only (`scan`, `show`).

### `scan`

Read-only. Walks cassette paths and reports unredacted findings.

```bash
npx shell-cassette scan tests/__cassettes__/
npx shell-cassette scan --json tests/__cassettes__/   # structured output for tooling
```

`--json` emits structured output locked at `scanVersion: 1`. See [`docs/cli.md`](./docs/cli.md#shell-cassette-scan-paths) for the full reference.

Exit `0` clean, `1` dirty, `2` error.

### `re-redact`

Re-applies the current redaction rules to existing cassettes. Idempotent. Use this when the bundle expands or you add a custom rule.

```bash
npx shell-cassette re-redact tests/__cassettes__/
npx shell-cassette re-redact --dry-run tests/__cassettes__/   # preview
```

Existing placeholders are kept; new findings get counters at `max(existing) + 1` per (source, rule). v1 cassettes upgrade to v2 in place. See [`docs/cli.md`](./docs/cli.md#shell-cassette-re-redact-paths) for the full reference.

Exit `0` no new redactions, `1` modified, `2` error.

### `show`

Read-only. Pretty-prints a single cassette for human inspection.

```bash
npx shell-cassette show tests/__cassettes__/login.json
npx shell-cassette show tests/__cassettes__/login.json --json | jq '.summary'
npx shell-cassette show tests/__cassettes__/login.json --full   # disable truncation
```

Default output is sectioned (header + per-recording listing). `--json` emits structured output locked at `showVersion: 1`. See [`docs/cli.md`](./docs/cli.md#shell-cassette-show-path) for the full reference.

Exit `0` ok, `2` error.

### `review`

Walk un-redacted findings interactively. For each finding, pick `(a)` accept, `(s)` skip, `(r)` replace, `(d)` delete, `(b)` back, or `(q)` quit. Decisions are batched and applied atomically on confirm. The skip action persists via the cassette's `_suppressed` field so `re-redact` and subsequent `review` runs do not re-flag the same match.

```bash
npx shell-cassette review tests/__cassettes__/foo.json
npx shell-cassette review tests/__cassettes__/foo.json --json   # read-only finding listing
```

`--json` emits a finding listing locked at `reviewVersion: 1` with default-safe match output (sha256 hash + preview). Use `--include-match` to include raw match values; treat the resulting JSON as sensitive.

See [`docs/cli.md`](./docs/cli.md#shell-cassette-review-path) for the full reference.

Exit `0` reviewed (with or without changes), `2` error.

### `prune`

Remove recordings by 0-based index. Atomic write.

```bash
npx shell-cassette prune tests/__cassettes__/foo.json --json   # list recordings
npx shell-cassette prune tests/__cassettes__/foo.json --delete 0,2
```

There is no interactive walk. Pipe `prune --json | jq` to pick indexes by command, args, or exit code, then pass the comma-separated list to `--delete`. Bare `prune <path>` (no flags) is an error. See [`docs/cli.md`](./docs/cli.md#shell-cassette-prune-path) for the full reference.

Exit `0` ok, `2` error.

### Cassette inspection workflow

A typical flow when a freshly-recorded cassette has findings:

```bash
# 1. Record (the ack gate runs at record time)
SHELL_CASSETTE_ACK_REDACTION=true npm test

# 2. Verify nothing leaked
npx shell-cassette scan tests/__cassettes__

# 3. If scan is dirty, walk findings and decide per-match
npx shell-cassette review tests/__cassettes__/the-dirty-one.json

# 4. Optionally remove unwanted recordings
npx shell-cassette prune tests/__cassettes__/the-dirty-one.json --json | jq ...
npx shell-cassette prune tests/__cassettes__/the-dirty-one.json --delete 0,5

# 5. Final verification before commit
npx shell-cassette scan tests/__cassettes__
git add tests/__cassettes__
git commit
```

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

Run `shell-cassette --help` for the full subcommand list, or `shell-cassette <command> --help` for per-subcommand flags.

## Adapter quirks

A few v0.4 specifics:

- **`shell-cassette/tinyexec` exports `exec` as an alias for `x`.** Mirrors tinyexec's own dual export so `import { exec } from 'tinyexec'` redirects to `import { exec } from 'shell-cassette/tinyexec'` without renaming.
- **`shell-cassette/tinyexec.xSync` throws.** Sync subprocess wrapping is not supported. Use async `x` (recommended), or import `xSync` directly from `tinyexec` (those calls bypass shell-cassette).
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
  // args with absolute mkdtemp paths normalized to <tmp>; cwd, env omitted
  // from the canonical form so cassettes are portable across machines;
  // stdin is included by default; opt out via custom canonicalize if needed)
  canonicalize: (call) => ({
    ...defaultCanonicalize(call),
    command: basenameCommand(call.command),  // /usr/bin/git matches git
  }),
}
```

Full reference for the redact config is in [docs/redact-patterns.md](docs/redact-patterns.md).

## What's in the match-tuple

The default matcher compares a call to a recording by deep-equality of their canonical forms. By default the canonical form is:

| Field | Matched? | Notes |
|---|---|---|
| `command` | yes | exact (use `basenameCommand` for cross-machine portability) |
| `args` | yes | absolute mkdtemp paths normalized to `<tmp>`; counter-tagged placeholders stripped |
| `stdin` | yes | redaction-normalized so a redacted cassette stdin matches a fresh call carrying the raw value |
| `cwd` | no | recorded for diagnostic display, not part of the tuple |
| `env` | no | recorded (with redaction applied) for diagnostic display, not part of the tuple |

For execa, `node: true` and `execaNode(...)` produce identical `Call` shapes: the user-provided file is stored as `Call.command`, and the `node` flag itself is not stored in the cassette. A recording made via `execa(file, args, { node: true })` replays a call made via `execaNode(file, args)` and vice versa.

If you need cwd or env in the match-tuple, or want to drop stdin, write a custom `canonicalize` function.

## Customizing matching

shell-cassette matches a call to a recording by deep-equality of their canonical forms. The default canonical form covers the common case (command + tmp-normalized args + stdin). For everything else, write a `canonicalize` function.

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

Four paradigms shell-cassette doesn't fit. Each is a fundamentally different test pattern, not a missing feature.

**Subprocess as state mutator.** shell-cassette replays recorded subprocess output; it does NOT actually re-execute the subprocess. Tests that use a subprocess to mutate state (`git commit` to make a real commit, `mkdir`/`touch` to create files, `npm install` to populate node_modules), then have downstream code that depends on that mutation, fail in replay mode: setup is mocked, no real mutation happens, downstream sees an unset-up state. Two patterns to watch for:

- Setup uses wrapped `exec` for state changes; a non-wrapped library (or a `vi.mock` chain that calls real `actual.x`) reads the resulting state. The wrapped calls return mocked output but the state never changed. The unwrapped reads see the true (unmutated) state.
- A test branches on subprocess output (`if status === clean`) and the branch performs writes the next assertion depends on. Replay returns the recorded "clean" output but the writes that depended on a real subprocess having run never happen.

For state orchestration where a real mutation has to happen, run those calls outside shell-cassette's scope (or in `passthrough` mode).

**Sync stream reads.** Tests that read `result.process.stdout` / `.stderr` / `.stdin` as live streams synchronously (rather than awaiting buffered `result.stdout` / `result.stderr` strings) hit a replay limit. shell-cassette captures buffered output, not stream events. Refactor the test to await the buffered fields, or run with `SHELL_CASSETTE_MODE=passthrough`.

**Mock-for-assertion patterns.** shell-cassette captures and replays subprocess **output**, not subprocess invocations. Tests that assert on **which command was called** (`expect(execMock).toHaveBeenCalledWith('git', ['commit', ...])`) are testing the wrong abstraction layer. Use `vi.mock` for that pattern. Examples in the wild: `prettier/pretty-quick`, `antfu/ni`, `jinghaihan/pncat`.

**Pipe-chaining subprocesses.** `.pipe()` between subprocesses (real-time stdout-to-stdin streaming) requires a live producer subprocess. shell-cassette has no live subprocess on replay. Calls to `.pipe()` on a replayed result throw `ShellCassetteError`. Tests that pipe-chain need to either run with `SHELL_CASSETTE_MODE=passthrough` or refactor to consume buffered output between calls.

## Real-world results

| Claim | What was demonstrated |
|---|---|
| Reproducible CI failures | One subprocess call recorded, then replayed 10 times in sequence. All 10 replays produce byte-identical stdout, stderr, and exitCode. If any external variance leaked through, at least one of the ten would diverge. |
| Determinism | Same demo as above. The recorded subprocess output drives every replay regardless of host node version, system clock, or locale. |
| Offline development | Subprocess script written to a temp file, recorded, then the script file is **deleted before replay**. A pre-replay sanity check uses Node's built-in `child_process` to confirm a real exec would now fail with ENOENT. Replay still returns the recorded output. The cassette is the only place the bytes can come from. |
| Failure-path testing | Successful subprocess (`exitCode: 0`) recorded. Cassette JSON read, mutated to `exitCode: 137`, written back. Replay throws an ExecaError-shaped object with `exitCode === 137`, `failed === true`. The user's `try/catch` runs. With `reject: false`, replay returns the same shape without throwing. |
| Speed | Full suite (end-to-end): unjs/nypm 98.8s record vs 0.9s replay (~110x). Tests-phase only: 211.72s vs 0.263s (~800x). Per-call: ~75ms vs ~1.2ms on a trivial node-eval workload (~60x). See speedup table below. |
| Credentials stay out | All 25 bundled patterns plus 5 curated env-key substrings exercised end-to-end. 30 cassettes recorded, scanned with `shell-cassette scan`, 0 dirty. The host's `LM_STUDIO_API_KEY` was caught by `API_KEY` substring match on every recording. Pattern reference: [docs/redact-patterns.md](docs/redact-patterns.md). |

### Speedup measurements

Three projects measured on Windows + Node 23.11. Point measurements, not benchmarks.

| Project | Tests / cassettes | Test-phase speedup | Wall speedup | Notes |
|---|---:|---:|---:|---|
| [unjs/nypm](https://github.com/unjs/nypm) | 161 / 91 | ~800x | ~110x | Full vitest suite under the auto-cassette plugin. 8 package-manager fixtures (npm, pnpm, yarn-classic, yarn-berry, deno, plus workspace variants). 22 env-key-match redactions caught on the host's `LM_STUDIO_API_KEY`. |
| [lerna-lite/lerna-lite](https://github.com/lerna-lite/lerna-lite) | 13 / 12 | ~6x | n/a | SC-wrapped subset across `core` and `version` packages. The broader 1656-test monorepo suite passes **99.5%** unchanged with the SC alias active in passthrough; the remaining 0.48% trace to a documented `child.process` streaming-access mismatch. |
| [sveltejs/cli](https://github.com/sveltejs/cli) (`sv` cli pkg) | 4 / 4 | ~17x | ~17x | Smallest measured. Proves the vitest plugin auto-binds without source patching when the project's source has a usable DI seam. One well-designed test replayed at ~40x. |

Wall-time speedup is bounded by vitest startup (~300-400ms regardless of mode). Test-phase speedup scales with subprocess work per test: the heavier the subprocess, the bigger the multiplier.

**What "speedup" means here.** Record runs the real subprocess once, replay reads the cassette. The multiplier is record test-phase divided by replay test-phase. Wall-time speedup includes vitest startup and is the smaller number. Both numbers vary with machine state, Node version, and background load.

**What "tests / cassettes" means here.** Not every test in a project's suite records to a cassette: tests that assert on subprocess side effects (filesystem state, network calls outside subprocess) can't replay because the side effect didn't happen. Tests reading `result.process.stdout` synchronously hit the same limit. The test count is the suite's full execution count under SC; the cassette count is what records without errors. Tests outside the cassettable surface either fall to passthrough or fail in replay with actionable errors. See [docs/troubleshooting.md](docs/troubleshooting.md) for patterns and workarounds.

## License

MIT, see `LICENSE`.
