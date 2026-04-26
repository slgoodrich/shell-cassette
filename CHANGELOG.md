# Changelog

All notable changes to shell-cassette are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

- **`shell-cassette/tinyexec` adapter**: drop-in replacement for tinyexec's `x` function. Same record/replay semantics as the execa adapter.
- **End-of-run redaction summary**: vitest plugin and `useCassette` emit a grouped summary at scope end listing all redactions and warnings, with `⚠️` markers. Designed to be hard to miss in vitest's noisy output.
- **Cassette `_warning` field**: every cassette JSON now includes a top-level `_warning` field with a "review before commit" reminder. Catches the case where users pipe stderr to `/dev/null` in CI but still commit cassettes.
- **README sections**: tinyexec adapter overview, "Common gotchas" pointer to troubleshooting docs, "Real-world results" with cac and eslint-import-resolver-typescript benchmarks.
- **`docs/` directory** with per-adapter and per-feature guides:
  - `docs/execa.md`
  - `docs/tinyexec.md`
  - `docs/vitest-plugin.md`
  - `docs/troubleshooting.md`
- **JSDoc on `src/vitest.ts`** documenting the `deps.inline` requirement at module top.

### Changed

- Internal: extracted shared wrapper envelope (`src/wrapper.ts`) from `src/execa.ts`. Adapters now share a runner-agnostic envelope and pass runner-specific behavior via internal hooks (`RunnerHooks`, not exported).
- Core `shell-cassette` entry shrinks to `useCassette` and shared types.
- Long-value warning text rewritten to mention the key-only-matching limitation explicitly, so users know what they're being warned about.
- README rewrite: leads with reproducible-CI-failures framing instead of speed. Adapter content moved to `docs/` for cleaner separation.

### Notes

- Cassette schema is unchanged at `version: 1`. Existing v0.1 cassettes load and replay correctly under v0.2's execa adapter. Cassettes recorded by v0.2 are loadable by v0.1 (additive only). The new `_warning` field is unknown to v0.1's deserializer, which ignores it.
- **vitest 3.x and 4.x users must add `'shell-cassette'` to `test.server.deps.inline`**. See `docs/troubleshooting.md`.
- **tinyexec adapter limitations**: `result.process` is `null` on replay, `result.pipe()` and `for await (line of result)` throw `UnsupportedOptionError`, `result.kill()` is a no-op, sync field reads before await return undefined. See `docs/tinyexec.md`.
- **Known issue [#29](https://github.com/slgoodrich/shell-cassette/issues/29)**: AbortSignal/cancellation state (`isCanceled` for execa, `aborted` for tinyexec) is lost on replay. Cassette schema doesn't preserve it. Fix planned for v0.3+.
- **Known issue [#33](https://github.com/slgoodrich/shell-cassette/issues/33)**: `AckRequiredError` thrown on matcher miss in auto mode is misleading; will be augmented with matcher-miss context in v0.3.
- **Known issue [#34](https://github.com/slgoodrich/shell-cassette/issues/34)**: `durationMs` is recorded as `0` for tinyexec captures and may be `0` for execa. Will be properly measured in v0.3.

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
