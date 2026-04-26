# Troubleshooting

Common errors mapped to fixes. If you hit something that's not here, [open an issue](https://github.com/slgoodrich/shell-cassette/issues/new).

## "Vitest failed to find the runner"

Full error from vitest:

> Error: Vitest failed to find the runner. One of the following is possible:
> - "vitest" is imported directly without running "vitest" command
> - "vitest" is imported inside "globalSetup" (to fix this, use "setupFiles" instead, ...)
> - ...

**Cause:** vitest externalizes node_modules packages by default. shell-cassette/vitest registers `beforeEach` and `afterEach` at module top level, and externalized modules don't share the runner-state context with the test file.

**Fix:** add `'shell-cassette'` to `test.server.deps.inline` in your vitest config:

```ts
// vitest.config.ts
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

Required across vitest 3.x and 4.x. This is the standard pattern for vitest plugin packages.

## "Cannot find module 'tinyexec'" (or 'execa', or 'vitest')

You imported a shell-cassette sub-path that requires a peer dependency you haven't installed.

**Fix:** install the matching peer dep:

```bash
# For shell-cassette/execa
npm install execa

# For shell-cassette/tinyexec
npm install tinyexec

# For shell-cassette/vitest
npm install --save-dev vitest
```

Both `execa` and `tinyexec` are optional peer deps. Install whichever you import from.

## `AckRequiredError` on a test you expected to replay

The test expected to replay from a cassette but shell-cassette tried to record instead.

**Most common cause:** the matcher missed. shell-cassette's default matcher is `command + deep-equal args`. If a recording captured `git status --porcelain` and the test now calls `git status -uall`, the matcher fails. In auto mode (default), failure falls through to the record path. The record path requires the ack gate.

**Fix paths:**

- **If you want to replay:** check the cassette JSON. Compare the recorded `call` shape against what your test is invoking. Common reasons matcher misses:
  - Argument differences (added/removed flag, reordered args, version bump in args)
  - Working directory differences (if you've configured cwd matching)
  - Different env var values (if you've configured env matching)
- **If you want to re-record:** delete the cassette file and re-run with `SHELL_CASSETTE_ACK_REDACTION=true`.
- **If you're hitting this in CI:** CI=true forces replay-strict mode. Failures here mean the cassette is stale. Re-record locally and commit.

Tracked by [#33](https://github.com/slgoodrich/shell-cassette/issues/33): error message will be augmented to include matcher-miss context in v0.3.

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
  redactEnvKeys: ['STRIPE_API_KEY', 'OPENAI_API_KEY'],
}
```

Substring match, case-insensitive. `STRIPE` would also match `STRIPE_KEY`, `STRIPE_TOKEN`, etc.

The curated list (`TOKEN`, `SECRET`, `PASSWORD`, etc.) catches the common cases. Your config extends it.

## What shell-cassette does NOT redact

Worth being explicit so nothing gets committed by accident:

- **stdout content** - if `git log` prints a token, shell-cassette captures it verbatim
- **stderr content** - same
- **command args** - `--token=ghp_xxx` lives in `call.args`, not redacted
- **env vars with non-curated names** - anything not matching a curated keyword stays as-is. shell-cassette emits a warning if the value is over 100 chars, but doesn't redact.
- **paths in cwd** - `/Users/yourname/projects/foo` stays in the cassette

**Always review cassettes before committing.** v0.3 will ship pattern-based detection for stdout/stderr/args (GitHub PATs, AWS keys, Stripe keys, etc.), but for now: review.
