# Changelog

All notable changes to shell-cassette are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-XX-XX

No public API changes from the main `shell-cassette` entry. The cassette schema stays at version 2 (additive `_suppressed` field, no v3 bump). v0.4 cassettes load and replay correctly under v0.5; v0.4 readers ignore the new field.

### Added

- **`shell-cassette show <path>` subcommand.** Pretty-prints a cassette for human inspection. Default terminal output is sectioned (header + per-recording with cwd, redacted env keys, exit + duration, line-count truncation). `--json` emits structured output locked at `showVersion: 1`. TTY-aware color, `--no-color` and `--color=always` overrides, `--full` to disable truncation, `--lines <N>` to set lines per stream (default 5).
- **`shell-cassette review <path>` subcommand.** Interactive walkthrough of unredacted findings. Action keys: `(a)` accept (apply default redaction), `(s)` skip (persist via `_suppressed`), `(r)` replace (substitute custom string; not for args), `(d)` delete (remove the recording), `(b)` back (revisit previous finding), `(q)` quit (discard all decisions), `(?)` help. Decisions are batched and applied atomically on confirm. `--json` emits a read-only finding listing locked at `reviewVersion: 1` with default-safe match output (hash + preview); `--include-match` opts into raw match values (UNSAFE for piping to logs / CI artifacts).
- **`shell-cassette prune <path>` subcommand.** Remove recordings by 0-based index. `--delete <indexes>` takes a comma-separated list, validates range and rejects duplicates, writes atomically. `--json` emits a read-only listing locked at `pruneVersion: 1` for `jq` composition. `--quiet` suppresses the stdout summary on `--delete`. Bare `prune <path>` (no flags) is an error; the workflow is `prune --json | jq` to pick indexes, then `prune --delete <list>`.
- **Cassette schema additive: `_suppressed: [{source, rule, position, matchHash}]` per recording.** Written by `review`'s `(s)kip` action; consulted by `re-redact` and `review`'s pre-scan to avoid re-flagging matches the user previously chose to skip. Skip semantics key off `matchHash` (sha256 hex), so the same secret in different positions across recordings is suppressed uniformly.
- **`CassetteInternalError`** typed `ShellCassetteError` subclass for exhaustiveness throws (`default: const _: never = action; throw new CassetteInternalError(...)`). Programmatic catches on `ShellCassetteError` still pick it up.

### Changed

- The bin's `--help` text now lists 5 subcommands (`scan`, `re-redact`, `show`, `review`, `prune`).
- `re-redact` and `review`'s pre-scan both consult cassette `_suppressed` entries. Matches whose hash is in any recording's suppressed list are not re-flagged on subsequent runs.
- `RedactOptions` (internal pipeline shape) gains optional `suppressedHashes: ReadonlySet<string>`. v0.4 callers (recorder, canonicalize) pass undefined and behave identically; v0.5's `re-redact` and `review` pass populated sets built from `_suppressed` entries.

### Notes

- **Prompt strings are NOT API.** Bots should use `--json` modes plus `re-redact` for automation, not parse interactive prompt text.
- **Match values in `--json` output default to hash + preview format.** Use `--include-match` for raw values; treat the resulting JSON as sensitive.
- **`prune --interactive` was cut from v0.5.** `prune --json | jq` plus `prune --delete <list>` covers the workflow without a state machine. Revisit if users ask.
- **`(r)eplace` in `review` is unavailable for args** (canonicalize-incompatible). Documented limitation; users can `(d)elete` the recording instead, or hand-edit the cassette JSON.

## [0.4.0] - 2026-04-28

### BREAKING CHANGES

- **Cassette schema bumped from version 1 to version 2.** v0.3 readers reject v2 cassettes with `CassetteCorruptError`; v0.4 readers accept both v1 and v2. v1 cassettes are upgradeable in place via `shell-cassette re-redact <path>`.
- **The v0.2/v0.3 `redactEnv()` function is removed.** Use `redact()` for the unified pipeline, or rely on the recorder to apply redaction transparently at record time.
- **`Config.redactEnvKeys` is renamed to `Config.redact.envKeys`** under the new composed `RedactConfig` shape. Migration:
  ```diff
  - export default { redactEnvKeys: ['STRIPE_API_KEY'] }
  + export default { redact: { envKeys: ['STRIPE_API_KEY'] } }
  ```
- The cassette `_warning` field message is updated to reflect new coverage and residual risks.

### Added

- **25 bundled credential pattern rules** (see `docs/redact-patterns.md`). Default ON. Applies to env values, args, stdout lines, stderr lines, and `allLines`. Covers GitHub (6 token shapes), AWS access key IDs, Stripe (4), OpenAI, Anthropic, Google, Slack (token + webhook URL), GitLab, npm, DigitalOcean, SendGrid, Mailgun, Hugging Face, PyPI, Discord, Square.
- **User-supplied custom rules** via `Config.redact.customPatterns: RedactRule[]`. Each rule has a kebab-case `name`, a `pattern` (regex or `(s) => string` function), and an optional `description`. Same five-source coverage as the bundle.
- **Suppress list** via `Config.redact.suppressPatterns: RegExp[]`. Checked first, before bundle and custom rules. A suppressed value is exempt from all rules and from the long-value warning.
- **Per-cassette redaction override**: `useCassette(name, { redact: false }, fn)`. Coarse-grained; per-stream toggling not supported.
- **Long-value warning threshold tuned from 100 to 40 chars** with a new `warnPathHeuristic` (default true) that suppresses warnings on values containing `/`, `\`, `:`, or whitespace. Both tunable via `Config.redact.warnLengthThreshold` and `Config.redact.warnPathHeuristic`.
- **Rule-tagged placeholders with counters**: `<redacted:source:rule-name:N>`. Counter scope is per-cassette per (source, rule), incremented per occurrence.
- **Schema v2 fields**: top-level `recordedBy: { name, version }` and per-recording `redactions: [{ rule, source, count }]`. Both are additive; v0.3 readers ignore unknown top-level fields but reject the version bump (hence the breaking change).
- **`BUNDLED_PATTERNS` constant exported** from the main entry for user composition.
- **New CLI binary `shell-cassette`** with `scan` and `re-redact` subcommands. `scan` is read-only and reports unredacted findings; `re-redact` re-applies the current rules to existing cassettes (idempotent). Exit codes per command are documented in `--help`.
- **`shell-cassette/vite-plugin` export** with `shellCassetteAlias({ adapters })`. Vite/Vitest plugin that redirects bare `tinyexec` / `execa` imports to shell-cassette's adapters with an importer guard so shell-cassette's own internal imports resolve to the real package. Closes [#84](https://github.com/slgoodrich/shell-cassette/issues/84).
- **`shell-cassette/tinyexec` exports `exec` as an alias for `x`.** Mirrors tinyexec's own dual export; users who import `{ exec }` from `tinyexec` can redirect without renaming. Closes [#77](https://github.com/slgoodrich/shell-cassette/issues/77).
- **`shell-cassette/tinyexec` exports `xSync` as a stub** that throws a clear error pointing to async `x` or v0.5. Sync subprocess wrapping requires synchronous lazy-load support; tracked in [#82](https://github.com/slgoodrich/shell-cassette/issues/82).
- **Property-based tests** for redaction idempotence, scan/record symmetry, and re-redact determinism.

### Changed

- **The default redaction pipeline now runs against env values, args, stdout, stderr, and `allLines`** (was env-only in v0.2/v0.3). Existing cassettes recorded under v0.2/v0.3 retain their original (unredacted) content; run `shell-cassette re-redact <path>` to apply v0.4 rules in place.
- **The canonicalize pipeline strips counter-tagged placeholders for args before deep-equal matching.** Cassettes with redacted args replay correctly across runs (placeholder counters can drift between cassette versions; the canonical form is counter-stripped).
- **The ack-gate message enumerates coverage** (bundled rules, curated env keys, custom rules) and explicit residual-risk gaps (AWS Secret Access Keys, JWTs, encoded credentials, binary, cwd, stdin).
- **`result.process` on tinyexec replay throws a clear `ShellCassetteError`** instead of silently returning `null`. Tests that read `result.process.stdout` / `.stderr` / `.stdin` get pointed at `result.stdout` / `result.stderr` (the buffered fields) or `SHELL_CASSETTE_MODE=passthrough`. Closes [#83](https://github.com/slgoodrich/shell-cassette/issues/83).
- **Cassette path-too-long errors propagate loudly** instead of being swallowed by the path resolver. Closes [#73](https://github.com/slgoodrich/shell-cassette/issues/73).

### Notes

- **Documented residual gaps** in the redaction surface: AWS Secret Access Keys (caught only by length warning), JWTs (default-off; opt-in via custom rule), encoded credentials (`Authorization: Basic ...`, base64 YAML/JSON), binary output (`BinaryOutputError`), `cwd` values, subprocess `stdin`. See README's "Not redacted (residual risks)" section and `docs/troubleshooting.md` "Residual risks and gaps in redaction".
- **Cassettes recorded by v0.4 are NOT loadable by v0.3.** v0.3's deserializer rejects the schema version. v0.4 still loads v0.3 cassettes; mixed-version teams should pin to v0.4 across the team.

## [0.3.0] - 2026-04-26

### BREAKING CHANGES

- **The matcher API is replaced with a canonicalize primitive.** The `MatcherFn` type and the `(call, recording) => boolean` shape are removed entirely. The new primitive is `Canonicalize: (call) => Partial<Call>`, with implicit deep-equal comparison of canonical forms. Migration:
  ```diff
  - matcher: (call, rec) => call.command === rec.call.command && deepEqual(call.args, rec.call.args)
  + canonicalize: (call) => ({ command: call.command, args: call.args })
  ```
- `Config.matcher` is renamed to `Config.canonicalize` (type changed accordingly).
- The `MatcherFn` type export is removed from the main `shell-cassette` entry.

### Added

- **`Canonicalize` type**: `(call: Call) => Partial<Call>`. The matcher primitive.
- **`defaultCanonicalize`**: the new default. Includes `command` (exact) and `args` (with absolute mkdtemp paths normalized to `<tmp>` token); excludes `cwd`, `env`, `stdin` so cassettes are portable across machines.
- **`normalizeTmpPath(s)`**: per-OS regex helper. Replaces tmp-prefix + one path component with `<tmp>`. Used internally by the default; exported for composition in custom canonicalize functions.
- **`basenameCommand(cmd)`**: cross-platform basename helper. Strips `.exe` on Windows. Opt-in for users who need cross-machine command portability (`/usr/bin/git` matches `git`).
- **`useCassette` gains an optional middle `options` argument**: `useCassette(path, options, fn)` for per-call canonicalize override. Original `useCassette(path, fn)` shape unchanged.
- **`UseCassetteOptions` type** with `canonicalize?: Canonicalize` field.
- **Property-based tests** via `fast-check` (devDependency). Cover serializer round-trip, normalizeTmpPath idempotence, canonicalize determinism, and matcher invariants.

### Changed

- **The default matching behavior now normalizes mkdtemp paths in args.** Existing cassettes get strictly more permissive matching: tests that passed under v0.2 continue to pass under v0.3. Tests that bounced on mkdtemp variance (e.g., `varletjs/varlet-release` pattern) now succeed without user opt-in.
- **`ReplayMissError` shows canonical forms.** When a match fails, the error message includes the unmatched call's canonical form and up to 10 recordings' canonical forms (with `... (N more)` truncation). Easier debugging when matcher behavior isn't what you expected.

### Notes

- Cassette schema is unchanged (still version 1). v0.2 cassettes load and replay correctly under v0.3.
- The default canonicalize is conservative. Patterns NOT normalized (nested mkdtemp dirs, relative tmp paths via `path.relative`, custom `$TMPDIR` outside our regex table, `process.cwd()` substrings in args) are documented in the README's "Documented limitations" section, each with a one-line workaround via custom canonicalize.

## [0.2.0] - 2026-04-26

### BREAKING CHANGES

- `execa` adapter moved from main `shell-cassette` entry to a `shell-cassette/execa` sub-path. v0.1's `import { execa } from 'shell-cassette'` no longer works. Migration:
  ```diff
  - import { execa } from 'shell-cassette'
  + import { execa } from 'shell-cassette/execa'
  ```
- Both `execa` and `tinyexec` peer deps are now optional. Install only the runner(s) you actually use.
- **Replay mode now refuses to passthrough when no active cassette session is bound.** v0.1/v0.2-pre would silently fall through to the real subprocess if `CI=true` (which forces replay) but the user called `execa`/`x` outside any `useCassette` scope and without the vitest plugin loaded. v0.2 throws `NoActiveSessionError` with fix instructions. Opt out by setting `SHELL_CASSETTE_MODE=passthrough` explicitly. Closes [#32](https://github.com/slgoodrich/shell-cassette/issues/32).

### Added

- **`aborted: boolean` field in cassette `Result` schema**: preserves AbortSignal/cancellation state end-to-end. execa records `r.isCanceled`, tinyexec records `r.aborted`. Replay synthesizes back to the runner's native field. Schema-additive: legacy cassettes without the field deserialize as `aborted: false`. No version bump. Closes [#29](https://github.com/slgoodrich/shell-cassette/issues/29).
- **`shell-cassette/tinyexec` adapter**: drop-in replacement for tinyexec's `x` function. Same record/replay semantics as the execa adapter.
- **`MissingPeerDependencyError`**: thrown by every adapter sub-path (`shell-cassette/execa`, `shell-cassette/tinyexec`, `shell-cassette/vitest`) when its peer dep can't be resolved. Replaces the bare `"Cannot find module"` Node trace with install instructions for npm, pnpm, and yarn. Closes [#35](https://github.com/slgoodrich/shell-cassette/issues/35).
- **End-of-run redaction summary**: vitest plugin and `useCassette` emit a grouped summary at scope end listing all redactions and warnings, with `⚠️` markers. Designed to be hard to miss in vitest's noisy output.
- **Cassette `_warning` field**: every cassette JSON now includes a top-level `_warning` field with a "review before commit" reminder. Catches the case where users pipe stderr to `/dev/null` in CI but still commit cassettes.
- **README sections**: tinyexec adapter overview, "Common gotchas" pointer to troubleshooting docs, "Real-world results" with cac and eslint-import-resolver-typescript benchmarks.
- **`docs/` directory** with per-adapter and per-feature guides:
  - `docs/execa.md`
  - `docs/tinyexec.md`
  - `docs/vitest-plugin.md`
  - `docs/troubleshooting.md`
- **JSDoc on `src/vitest.ts`** documenting the `deps.inline` requirement at module top.
- **`VitestPluginRegistrationError`**: when vitest externalizes shell-cassette and hook registration fails, the plugin now throws this typed error with the exact `deps.inline` config snippets for vitest 3.x and 4.x instead of letting the upstream "Vitest failed to find the runner" message through. Closes [#31](https://github.com/slgoodrich/shell-cassette/issues/31).

### Changed

- Internal: extracted shared wrapper envelope (`src/wrapper.ts`) from `src/execa.ts`. Adapters now share a runner-agnostic envelope and pass runner-specific behavior via internal hooks (`RunnerHooks`, not exported).
- Core `shell-cassette` entry shrinks to `useCassette` and shared types.
- Long-value warning text rewritten to mention the key-only-matching limitation explicitly, so users know what they're being warned about.
- README rewrite: leads with reproducible-CI-failures framing instead of speed. Adapter content moved to `docs/` for cleaner separation.
- **`durationMs` is now measured uniformly** around `realCall` via `performance.now()` for both adapters. Previously: tinyexec recorded `0` (no native field), execa relied on its own field which is sometimes `0`. Closes [#34](https://github.com/slgoodrich/shell-cassette/issues/34).
- **`AckRequiredError` on auto-mode matcher miss now augments the message** with the actual matched call signature and a "no recording matched" prefix. Same error class (programmatic catches still work), but the diagnostic surfaces the real cause instead of only the ack-required help text. Closes [#33](https://github.com/slgoodrich/shell-cassette/issues/33).

### Notes

- Cassette schema is unchanged at `version: 1`. Existing v0.1 cassettes load and replay correctly under v0.2's execa adapter. Cassettes recorded by v0.2 are loadable by v0.1 (additive only). The new `_warning` field is unknown to v0.1's deserializer, which ignores it.
- **vitest 3.x and 4.x users must add `'shell-cassette'` to `test.server.deps.inline`**. See `docs/troubleshooting.md`.
- **tinyexec adapter limitations**: `result.process` is `null` on replay, `result.pipe()` and `for await (line of result)` throw `UnsupportedOptionError`, `result.kill()` is a no-op, sync field reads before await return undefined. See `docs/tinyexec.md`.

## [0.1.0] - 2026-04-25

Initial release.

### Added

- Drop-in execa wrapper with record/replay
- vitest auto-cassette plugin
- Explicit `useCassette` API for non-vitest contexts
- Curated env-key redaction (TOKEN, SECRET, PASSWORD, etc.)
- Ack gate (`SHELL_CASSETTE_ACK_REDACTION=true`) required before recording
- Long-value warnings for env values over 100 chars not in curated list
- JSON cassette format with line-array stdout/stderr encoding
- Atomic cassette writes (temp file + rename)
- Optional `shell-cassette.config.{js,mjs}` for matcher and redaction overrides
- Nine typed error classes (`AckRequiredError`, `UnsupportedOptionError`, `ReplayMissError`, `ConcurrencyError`, `BinaryOutputError`, `CassetteCorruptError`, `CassetteCollisionError`, `CassetteIOError`, `CassetteConfigError`)
- ESM-only, Node 18+
