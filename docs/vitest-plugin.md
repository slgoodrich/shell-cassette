# vitest plugin

`shell-cassette/vitest` registers `beforeEach`/`afterEach` hooks that auto-cassette every test. One cassette per test, derived from the test's file path + describe chain + test name.

## Setup

Three pieces:

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
        inline: ['shell-cassette'],   // required - see Compatibility below
      },
    },
  },
})
```

```ts
// my-test.test.ts
import { test, expect } from 'vitest'
import { execa } from 'shell-cassette/execa'  // or shell-cassette/tinyexec

test('git branch', async () => {
  const { stdout } = await execa('git', ['branch', '--show-current'])
  expect(stdout).toBe('main')
})
```

That's it. The plugin sets the active cassette per test; subprocess calls inside the test record/replay automatically.

## Compatibility

### `deps.inline` is required (vitest 3.x and 4.x)

Vitest externalizes node_modules packages by default. The plugin's top-level `beforeEach`/`afterEach` calls fire outside the runner-aware context and throw "Vitest failed to find the runner."

shell-cassette catches that throw at registration and rethrows as `VitestPluginRegistrationError` with the fix path inline (config snippets for both vitest 3.x and 4.x). You'll see the actionable error class instead of vitest's bare message.

Add `'shell-cassette'` to `test.server.deps.inline` (vitest 3.x) or `test.deps.inline` (vitest 4.x). This is the standard pattern for vitest plugin packages - many plugins document it.

See [troubleshooting](troubleshooting.md#vitestpluginregistrationerror-vitest-failed-to-find-the-runner) for the full snippet.

### `vite-plus` (vite-plus/test) compatibility

shell-cassette has been tested against `vite-plus` 0.1.18 (a vitest 4 wrapper used by varlet projects). The plugin loads with `deps.inline` configured correctly. No vp-specific config beyond the standard inline directive.

### `vi.mock('execa')` or `vi.mock('tinyexec')` does NOT compose

If your project already wraps the subprocess runner with `vi.mock` (e.g., for safety guards or assertion stubs), shell-cassette can't compose inside the mock chain. The mock catches shell-cassette's internal runner import and either recurses infinitely or bypasses our wrapper.

**Fix:** redirect tests at the import level:

```diff
- import { x } from 'tinyexec'
+ import { x } from 'shell-cassette/tinyexec'
```

If the existing `vi.mock` provided safety guards, you'll need to drop them or move them elsewhere. shell-cassette doesn't enforce sandbox-cwd or similar guards - it records and replays.

## Cassette path layout

Default: cassettes land next to the test file in `__cassettes__/`:

```
tests/
  my-feature.test.ts
  __cassettes__/
    my-feature.test.ts/
      first-describe-block/
        my-test-name.json
      second-describe-block/
        another-test-name.json
```

The full path is `<test-file-dir>/<cassetteDir>/<test-file-basename>/<sanitized-describe-segments>/<sanitized-test-name>.json` where `<cassetteDir>` defaults to `'__cassettes__'`.

You can override `cassetteDir` via config:

```js
// shell-cassette.config.js
export default {
  cassetteDir: '../cassettes',  // outside the test directory
}
```

## Test discovery and `__cassettes__/`

If your test code dynamically registers tests by walking the test directory (e.g., one test per fixture subdir), make sure to exclude `__cassettes__/` alongside `__snapshots__/`:

```ts
for (const dirent of dirents) {
  if (
    !dirent.isDirectory() ||
    dirent.name === '__snapshots__' ||
    dirent.name === '__cassettes__'
  ) {
    continue
  }
  // ... register test for this fixture
}
```

Otherwise the cassette directory shows up as a phantom fixture on subsequent runs (after the first record run creates it).

## `test.concurrent` is rejected

The plugin uses a module-global to set the active cassette per test. Concurrent tests would race on this. The plugin throws `ConcurrencyError` at `beforeEach` time when it detects a `test.concurrent`.

**Use `useCassette` explicitly inside concurrent tests instead** - its AsyncLocalStorage-based context isolates per call:

```ts
import { useCassette } from 'shell-cassette'
import { x } from 'shell-cassette/tinyexec'

test.concurrent('parallel test 1', async () => {
  await useCassette('./cassettes/parallel-1.json', async () => {
    await x('git', ['status'])
  })
})

test.concurrent('parallel test 2', async () => {
  await useCassette('./cassettes/parallel-2.json', async () => {
    await x('git', ['log'])
  })
})
```

## End-of-run summary

When a test scope ends with new recordings, redactions, or warnings, the plugin emits a grouped summary to stderr:

```
shell-cassette: cassette saved (3 recordings, 1 redaction, 2 warnings): /path/to/cassette.json
  redacted: GH_TOKEN
  ⚠️  STRIPE_KEY: long value (104 chars), not in curated/configured list - may contain a credential...
```

Pure-replay tests stay silent. The summary makes redaction warnings hard to miss in vitest's output.

## Plugin internals

For the curious. The plugin's behavior:

- **`beforeEach(ctx)`**: derives the cassette path from `ctx.task` (file path + describe chain + test name, sanitized). Creates a `CassetteSession` and calls `setActiveCassette` to make it visible to wrapper calls.
- **`afterEach()`**: persists `session.newRecordings` to disk (if any), emits the end-of-run summary, clears the active cassette.

If you don't want auto-cassetting for a particular test (e.g., a test that's deliberately calling real subprocess for live state), there's no per-call mode override today. The escape hatch is to either move the test out of the auto-plugin's scope or stub manually.
