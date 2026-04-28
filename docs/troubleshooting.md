# Troubleshooting

Common errors mapped to fixes. If you hit something that's not here, [open an issue](https://github.com/slgoodrich/shell-cassette/issues/new).

## `VitestPluginRegistrationError` ("Vitest failed to find the runner")

shell-cassette/vitest catches the upstream "Vitest failed to find the runner" failure during hook registration and rethrows it as `VitestPluginRegistrationError` with the fix path inline:

> VitestPluginRegistrationError: shell-cassette/vitest plugin failed to register hooks.
>
> Most commonly this means vitest externalized shell-cassette without your config opting in.
> Add this to your vitest config:
>   // vitest 3.x
>   test: { server: { deps: { inline: ["shell-cassette"] } } }
>   // vitest 4.x
>   test: { deps: { inline: ["shell-cassette"] } }
> ...
> Original error: Vitest failed to find the runner. ...

**Cause:** vitest externalizes node_modules packages by default. shell-cassette/vitest registers `beforeEach` and `afterEach` at module top level, and externalized modules don't share the runner-state context with the test file.

**Fix:** add `'shell-cassette'` to `test.server.deps.inline` (vitest 3.x) or `test.deps.inline` (vitest 4.x):

```ts
// vitest.config.ts (vitest 3.x)
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    server: {
      deps: {
        inline: ['shell-cassette'],
      },
    },
    // ... your other test config
  },
})
```

This is the standard pattern for vitest plugin packages.

## `MissingPeerDependencyError` on adapter import

You imported a shell-cassette sub-path that requires a peer dependency you haven't installed. The error message includes the install command.

**Fix:** install the matching peer dep:

```bash
# For shell-cassette/execa
npm install execa

# For shell-cassette/tinyexec
npm install tinyexec

# For shell-cassette/vitest
npm install --save-dev vitest
```

All three are optional peer deps. Install whichever you import from. The error class is the same (`MissingPeerDependencyError`) regardless of which sub-path triggered it.

## `AckRequiredError` on a test you expected to replay

The test expected to replay from a cassette but shell-cassette tried to record instead. The error message starts with:

> auto mode: no recording matched `git status --porcelain`, attempted to record but ack gate not set.

**Most common cause:** the matcher missed. shell-cassette's default matcher is `command + deep-equal args`. If a recording captured `git status --porcelain` and the test now calls `git status -uall`, the matcher fails. In auto mode (default), failure falls through to the record path. The record path requires the ack gate.

**Fix paths:**

- **If you want to replay:** check the cassette JSON. Compare the recorded `call` shape against what your test is invoking. Common reasons matcher misses:
  - Argument differences (added/removed flag, reordered args, version bump in args)
  - Working directory differences (if you've configured cwd matching)
  - Different env var values (if you've configured env matching)
- **If you want to re-record:** delete the cassette file and re-run with `SHELL_CASSETTE_ACK_REDACTION=true`.
- **If you're hitting this in CI:** CI=true forces replay-strict mode. Failures here mean the cassette is stale. Re-record locally and commit.

## `NoActiveSessionError` in CI

> NoActiveSessionError: shell-cassette is in replay mode but no active cassette session is bound.

You're running with `CI=true` (which forces replay mode) or `SHELL_CASSETTE_MODE=replay`, but the call site isn't inside a `useCassette` scope and the vitest plugin isn't loaded. Without a session, replay can't resolve a cassette. Falling through to the real subprocess would defeat "deterministic CI", so shell-cassette refuses.

**Fix one of:**

- Wrap the call site with `useCassette(path, async () => { ... })`.
- Import `shell-cassette/vitest` as a setupFile so the plugin auto-binds per test.
- Set `SHELL_CASSETTE_MODE=passthrough` to opt out of strict replay (real subprocess will run).

## `ReplayMissError` in CI

Same root cause as above (cassette doesn't match the call), but in `replay` mode (`CI=true` forces this) the wrapper throws directly instead of falling through.

**Fix:** re-record locally, commit the cassette.

## Test discovery picks up `__cassettes__/` directory as a fixture

If your test file walks its own directory looking for fixture subdirs (e.g., `fs.readdir(testDir, { withFileTypes: true })`), shell-cassette's auto-created `__cassettes__/` shows up as a phantom fixture.

**Fix:** exclude `__cassettes__` alongside any other meta-directories:

```ts
for (const dirent of dirents) {
  if (
    !dirent.isDirectory() ||
    dirent.name === '__snapshots__' ||
    dirent.name === '__cassettes__'
  ) {
    continue
  }
  // ... your fixture logic
}
```

**Alternative:** configure shell-cassette to put cassettes in a non-test path via `Config.cassetteDir`:

```ts
// shell-cassette.config.js
export default {
  cassetteDir: '../cassettes',  // outside the test dir
}
```

## `vi.mock('tinyexec')` (or 'execa') breaks shell-cassette

If your project wraps the runner package via `vi.mock` for safety guards or assertion stubs, shell-cassette can't compose inside the mock chain.

**Why:** `vi.mock('tinyexec')` catches ALL imports of `'tinyexec'`, including shell-cassette's internal one. If your mock then calls `shell-cassette/tinyexec`'s `x()`, that internally imports `'tinyexec'` again - which is the mock - infinite recursion.

**Fix:** redirect at the test-import level instead of via mock:

```diff
- import { x } from 'tinyexec'
+ import { x } from 'shell-cassette/tinyexec'
```

If you previously relied on the mock for safety guards (e.g., refusing to run subprocess outside a sandbox), you'll need to drop that guard or move it elsewhere. shell-cassette doesn't provide an equivalent - it records and replays, it doesn't enforce.

## `BinaryOutputError`

Subprocess produced non-UTF-8 bytes in stdout/stderr. shell-cassette v0.2 only supports UTF-8 cassettes.

**Workaround:** if you control the subprocess, redirect binary output to a file:

```ts
await x('ffmpeg', ['-i', 'input.mp4', '-y', 'output.mp4'])
// stdout from ffmpeg is logging/progress text (UTF-8); the binary output
// went to output.mp4. Reading output.mp4 in your test is fs work, not
// subprocess output, so shell-cassette doesn't interfere.
```

If you need binary stdout/stderr support, [open an issue](https://github.com/slgoodrich/shell-cassette/issues/new).

## "How do I redact a secret that isn't in the curated list?"

Add the env var name to your `shell-cassette.config.js`:

```js
export default {
  redact: {
    envKeys: ['STRIPE_API_KEY', 'OPENAI_API_KEY'],
  },
}
```

Substring match, case-insensitive. `STRIPE` would also match `STRIPE_KEY`, `STRIPE_TOKEN`, etc.

The curated list (`TOKEN`, `SECRET`, `PASSWORD`, etc.) catches the common cases. Your config extends it.

## What shell-cassette does NOT redact

shell-cassette v0.4 redacts what it can detect with 100% reliability and warns on suspicious-looking unredacted values. The bundle covers 25 prefix-anchored credential formats (GitHub, AWS access key IDs, Stripe, OpenAI, Anthropic, Slack, npm, etc.; see [docs/redact-patterns.md](redact-patterns.md)) plus curated env-key matching plus your own custom rules. What it doesn't redact is below.

### Residual risks and gaps in v0.4 redaction

- **AWS Secret Access Keys.** 40-char base64 with no documented prefix. Indistinguishable from generic hashes/UUIDs/build IDs by pattern alone. The long-value warning catches them at length 40+ when the value doesn't look like a path. If you ship cassettes that may contain AWS Secret Access Keys, add them to `redact.envKeys` (so the env value is whole-value redacted by key match) or write a project-specific custom rule.
- **JWTs.** Many JWTs in the wild are public ID tokens or JWKS responses, not bearer secrets. Bundling JWT detection produces false positives on routine OAuth flows. Opt-in via a custom rule when your JWTs are bearer-shaped:
  ```ts
  customPatterns: [{
    name: 'jwt-bearer',
    pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  }]
  ```
- **Encoded credentials.** `Authorization: Basic <base64>` headers and base64-encoded YAML/JSON secrets pass through. shell-cassette doesn't decode. Add a custom rule if your test surface includes them.
- **Binary output.** `BinaryOutputError` blocks recording when the subprocess emits non-UTF-8. Out of scope for v0.4.
- **`cwd` values.** Credentials in working-directory paths are vanishingly rare; not redacted.
- **Subprocess `stdin`.** Not captured in v0.4; nothing on disk to redact. v0.5 will capture stdin and apply the same pipeline.

Each gap has a workaround: long-value warning catches length anomalies, custom rules cover project-specific shapes, suppress patterns silence known fixtures, and `useCassette({ redact: false })` disables the pipeline for cassettes that legitimately need raw values (DO NOT commit those).

### Always run `shell-cassette scan` before committing

The scan CLI walks cassette files (or directories) and reports unredacted findings. Exit code is 1 when any cassette has findings. See "Verifying cassettes are safe" below for the pre-commit hook recipe.

## Verifying cassettes are safe

Run `shell-cassette scan` on every cassette before committing:

```bash
npx shell-cassette scan tests/__cassettes__/
```

Exit codes:

- `0` - all cassettes clean
- `1` - at least one cassette has findings (commit should be blocked)
- `2` - error (missing path, malformed cassette, conflicting flags)

The scanner reports what `record` mode would have redacted. A clean exit means: every env value with a curated key name is already a placeholder, every bundled pattern that fires on a value in env/args/stdout/stderr/allLines is already a placeholder, and every custom rule you've configured is already applied.

Useful flags:

- `--json` - structured output for CI gating or reporting tools.
- `--quiet` - suppress stdout (use the exit code only).
- `--config <path>` - override config discovery.
- `--no-bundled` - check ONLY user rules and suppress list.

Pair the scan with the [pre-commit hook recipe in the README](../README.md#pre-commit-hook).

## Migrating cassettes when the bundle expands

When you upgrade shell-cassette, run `shell-cassette re-redact` to re-apply the current rules to existing cassettes:

```bash
npx shell-cassette re-redact tests/__cassettes__/
```

Idempotent: running twice yields identical output. Existing placeholders are preserved; new findings get counters at `max(existing) + 1` per (source, rule). v1 cassettes are upgraded to v2 in place.

Use `--dry-run` to preview without writing:

```bash
npx shell-cassette re-redact --dry-run tests/__cassettes__/
```

Exit codes:

- `0` - no new redactions applied (cassettes already covered)
- `1` - at least one cassette modified (or would be modified in dry-run)
- `2` - error

After upgrading, commit the modified cassettes alongside the version bump. Reviewers should diff to confirm only placeholder expansion, not value changes.

## When stdout contains a credential the test asserts on

If your test asserts on stdout content that legitimately contains a credential (e.g., an OAuth flow test that prints a token), the v0.4 default pipeline replaces the credential with a placeholder. The replayed stdout your test sees is the placeholder, not the credential.

Two options, in order of preference:

1. **Restructure the test not to assert on the credential string.** Assert on shape (`/^ghp_[A-Za-z0-9]{36}$/`) or on a different observable (exit code, surrounding text). Most credential-printing tests don't actually need exact-match.
2. **Disable redaction for that specific cassette via `useCassette({ redact: false })`:**
   ```ts
   await useCassette('./cassettes/oauth-flow.json', { redact: false }, async () => {
     const r = await execa('my-cli', ['login'])
     expect(r.stdout).toContain('ghp_actual_token_value')
   })
   ```
   The cassette WILL contain plaintext credentials. Do NOT commit it. Add the path to `.gitignore`, or move the cassette outside the repo.

`{ redact: false }` is intentionally per-cassette, not per-stream. shell-cassette doesn't support "redact env but not stdout" scoping; the choice is binary.

## Tests asserting on subprocess side effects (filesystem, network, etc.)

shell-cassette is a VCR-style recorder: it captures what the subprocess returned (stdout, stderr, exit code, signal), not what the subprocess did to the world. If your test runs a subprocess for its side effects, replay returns the recorded result but the side effects do not happen.

**Symptom:** test passes during record, fails during replay with assertion errors on filesystem state, network state, database rows, etc.

```ts
test('npm install creates node_modules', async () => {
  await execa('npm', ['install'])
  expect(existsSync('node_modules')).toBe(true) // FAILS in replay
})
```

**Root cause:** the `npm install` recording captures stdout (`added 230 packages`) and exit code 0. On replay, shell-cassette returns that recorded result without spawning npm. `node_modules/` is never created. The `existsSync` assertion sees the non-mutated state.

**Mitigations, in order of preference:**

1. **Refactor the test to assert on stdout, not on side effects.** `expect(stdout).toContain('added 230 packages')`. The recorded subprocess output is what shell-cassette can deliver deterministically.
2. **Use `SHELL_CASSETTE_MODE=passthrough` for tests that genuinely need real side effects.** This bypasses shell-cassette and runs the real subprocess. You lose determinism for that test but get the actual mutation. Pair with a hermetic temp directory so the side effect is contained.
3. **Move the side effect outside the cassette session.** Setup code that creates fixtures (e.g., `git init` to initialize a fresh repo) should run as real subprocess work BEFORE any `useCassette` or vitest plugin scope is active. Reserve cassetted calls for the actual code-under-test.

This is not a bug in shell-cassette and not a redaction concern; `useCassette({ redact: false })` does NOT help here (different concern). The VCR model only captures I/O at the subprocess boundary.

## `NoActiveSessionError` from `beforeAll` / `beforeEach` setup

When tests use vitest's `beforeAll` or `beforeEach` to subprocess-set-up fixture state (e.g., `git init` for a temp repo), that setup runs OUTSIDE any active cassette session. The vitest plugin opens a session per `test`, not per setup hook. If the setup imports from `shell-cassette/execa` or `shell-cassette/tinyexec` (or routes through `shellCassetteAlias` from `shell-cassette/vite-plugin`), the wrapper sees no active session.

**Symptom:** `NoActiveSessionError: shell-cassette is in replay mode but no active cassette session is bound`, raised from a `beforeAll` or `beforeEach` body, despite cassettes existing on disk for the test cases.

**Root cause:** setup hooks run before the per-test session opens. With `CI=true` (which forces `replay`), the wrapper refuses to passthrough; it throws.

**Fixes:**

- **Use REAL `tinyexec` / `execa` in setup; reserve the SC-wrapped imports for test bodies.** Import `import { x } from 'tinyexec'` directly inside `beforeAll` for fixture creation; import `import { x } from 'shell-cassette/tinyexec'` in the test files. If you use `shellCassetteAlias` to redirect bare imports, the alias only affects imports under your `tests/` (or wherever the alias is scoped); restructure the alias scope to exclude your fixture-setup files, or import the real package via a path that bypasses the alias.
- **Set `SHELL_CASSETTE_MODE=passthrough` for setup-only flows.** If a whole test file is fixture-heavy and you don't want any of it cassetted, set the env var at the top of the file or via a setup file that runs before vitest dispatches.
- **Move the setup into the test body inside `useCassette`.** Tests that need their setup inside a session can call `useCassette` explicitly and place the setup work inside the callback.

This pattern matters most when using `shellCassetteAlias` to retrofit shell-cassette into an existing project: bare imports of `tinyexec` get redirected, and setup helpers can no longer reach the real subprocess unless explicitly carved out.

## Module-level subprocess caches break per-test cassettes

Source code that memoizes a subprocess result at module level (`const hasCorepack = cached(() => x('corepack', ['--version']))`) records into the FIRST test's cassette. If vitest reloads the module per test, replay misses for subsequent tests because the cached call only fires once per module instance.

**Symptom:** tests pass during record, fail intermittently during replay with `ReplayMissError` for a subprocess call your test code does not appear to make directly.

**Root cause:** the cache lives at module scope. The first time the module is imported during a test run, the cached function fires and records into whatever session is active at that moment. Subsequent test sessions don't see that recording in their own cassettes; the cache also doesn't fire again because the module is loaded.

**Mitigations:**

1. **Refactor to avoid module-level subprocess caches.** Move the cache into a per-test-or-per-call lifecycle (e.g., a function arg, a request-scoped object). Cleanest fix.
2. **`vi.resetModules()` between tests.** Forces vitest to re-import modules, which re-fires the cache once per test inside that test's session. Works but adds overhead.
3. **Use a single shared cassette per test file.** If the cached subprocess call genuinely should fire once per file, scope cassettes to the file (not the test) so all tests share the same recording. Requires custom path logic.

shell-cassette can't auto-detect this pattern. The `_redactions` schema field and the path resolver work per-recording; a module-level cache is invisible to them. Tracked in [#76](https://github.com/slgoodrich/shell-cassette/issues/76); future work may add a shared-cassette mode.

## Naive `resolve.alias` self-loops; use `shellCassetteAlias`

If you redirect `tinyexec` (or `execa`) imports to shell-cassette's adapter via vite's `resolve.alias`, the naive form self-loops:

```ts
// BROKEN: shell-cassette's adapter ALSO imports `tinyexec`,
// the alias catches that import too, infinite loop
export default defineConfig({
  resolve: { alias: { tinyexec: 'shell-cassette/tinyexec' } },
})
```

shell-cassette ships a vite plugin that adds the importer guard:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { shellCassetteAlias } from 'shell-cassette/vite-plugin'

export default defineConfig({
  plugins: [shellCassetteAlias({ adapters: ['tinyexec'] })],
  test: {
    setupFiles: ['shell-cassette/vitest'],
  },
})
```

The plugin's `resolveId` hook redirects bare `tinyexec` imports from user code, BUT skips redirection when the importer is itself a `shell-cassette/...` file. shell-cassette's internal `import 'tinyexec'` resolves to the real package; user code resolves to the adapter.

`adapters` defaults to `['tinyexec']`. Pass `['execa']` or `['tinyexec', 'execa']` if you wrap the other library or both.

## Cassette path exceeds 240 chars

Windows fails when total path length exceeds 240 chars. shell-cassette's path sanitizer caps test name segments at 80 chars and adds a 6-char hash on collision, but deeply-nested describe blocks plus a long test file path plus a long `cassetteDir` can still overflow.

**Symptom:** error at cassette write time naming the path that exceeded 240 chars.

**Fixes:**

- **Shorten describe / test names.** Cassette path includes describe-chain segments. Three nested 60-char describe blocks alone consume 180 chars.
- **Shorten `cassetteDir`.** Default is `__cassettes__` (13 chars). If you've configured `tests/integration/__cassettes__/` (32 chars), consider moving cassettes to a shorter root.
- **Move test files closer to the project root.** A test at `tests/feature.test.ts` produces a shorter cassette path than one at `packages/server/src/__tests__/integration/feature.test.ts`.

A `cassettesRoot` config (project-root-relative cassette directory, decoupling cassette paths from test file location) is tracked in [#81](https://github.com/slgoodrich/shell-cassette/issues/81) for v0.5.

## `xSync` from shell-cassette/tinyexec throws

shell-cassette/tinyexec's `xSync` is a stub that throws a clear error pointing to async `x`:

> shell-cassette/tinyexec.xSync is not yet wrapped (tracked in #82). Sync subprocess wrapping requires synchronous lazy-load support, planned for v0.5.

**Why:** wrapping sync subprocess execution requires synchronous module loading for the peer dep, which shell-cassette doesn't currently support. The async `x` adapter uses top-level await for resolution.

**Options:**

- **Use async `x`** (recommended). Refactor sync call sites to async; you get cassette coverage.
- **Import `xSync` directly from `tinyexec`.** Those calls bypass shell-cassette and run real subprocess. Acceptable for pre-flight version checks and similar non-determinism-sensitive paths.
- **Wait for v0.5** ([#82](https://github.com/slgoodrich/shell-cassette/issues/82)).

## `result.process` throws on tinyexec replay

Tests that read `result.process.stdout` (streaming) or `result.process.stderr` (sync inspection) on replay get a clear error:

> result.process is not available in replay mode. shell-cassette synthesizes subprocess results from cassettes; no live ChildProcess exists. Tests that read result.process.stdout / .stderr / .stdin streams must either run with SHELL_CASSETTE_MODE=passthrough, or refactor to read result.stdout / result.stderr (the buffered fields).

**Why:** shell-cassette can't synthesize a live `ChildProcess` from a cassette. The buffered `result.stdout` / `result.stderr` fields ARE synthesized; the live stream object is not.

**Options:**

- **Refactor to use `result.stdout` / `result.stderr`** (the buffered string fields). They contain the full captured output and are deterministic.
- **`SHELL_CASSETTE_MODE=passthrough`** for tests that genuinely need stream access.
- **Wait for v0.5**; future work may synthesize a fake stream from buffered output ([#83](https://github.com/slgoodrich/shell-cassette/issues/83)).
