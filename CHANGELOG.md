# Changelog

All notable changes to shell-cassette are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
