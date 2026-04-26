// shell-cassette/vitest plugin: registers global beforeEach/afterEach hooks
// for auto-cassetting per test.
//
// SETUP REQUIREMENT: when shell-cassette is installed as a node_modules
// dependency, vitest externalizes it by default. The plugin detects this
// and throws VitestPluginRegistrationError with the deps.inline fix path.
// Add 'shell-cassette' to test.server.deps.inline (vitest 3.x) or
// test.deps.inline (vitest 4.x) in your vitest config:
//
//   test: { server: { deps: { inline: ['shell-cassette'] } } }
//
// See docs/vitest-plugin.md for details.

import { getConfig } from './config.js'
import {
  ConcurrencyError,
  MissingPeerDependencyError,
  VitestPluginRegistrationError,
} from './errors.js'
import { writeCassetteFile } from './io.js'
import { deriveCassettePathFromTask } from './plugin.js'
import { serialize } from './serialize.js'
import {
  clearActiveCassette,
  getActiveCassette,
  registerSessionPath,
  setActiveCassette,
  unregisterSessionPath,
} from './state.js'
import { summarizeSession } from './summary.js'
import type { CassetteSession } from './types.js'

// Wrap any error thrown during hook registration with deps.inline guidance.
// Exported for unit testing; consumers shouldn't import it.
//
// The most common failure here is vitest externalizing shell-cassette so the
// plugin module loads in a different module graph than vitest's runner. The
// observable symptom is a thrown Error mentioning "runner". We don't gate the
// wrap on the message text — registration at module top should never throw
// for any other reason, so any throw here gets the deps.inline diagnostic
// appended (with the original error preserved verbatim).
export function wrapRegistrationError(e: unknown): VitestPluginRegistrationError {
  const original = e instanceof Error ? e : new Error(String(e))
  return new VitestPluginRegistrationError(
    'shell-cassette/vitest plugin failed to register hooks.\n\n' +
      'Most commonly this means vitest externalized shell-cassette without your config opting in.\n' +
      'Add this to your vitest config:\n' +
      '  // vitest 3.x\n' +
      '  test: { server: { deps: { inline: ["shell-cassette"] } } }\n' +
      '  // vitest 4.x\n' +
      '  test: { deps: { inline: ["shell-cassette"] } }\n\n' +
      'See https://github.com/slgoodrich/shell-cassette/blob/main/docs/troubleshooting.md\n\n' +
      `Original error: ${original.message}`,
  )
}

// Resolve vitest via dynamic import so we can wrap "Cannot find module" with
// an actionable error. Top-level await means consumers importing
// shell-cassette/vitest wait for this resolution. Hooks register synchronously
// after the await; vitest's setupFile loading awaits the entire chain, so
// hooks are registered before any test runs.
let beforeEach: typeof import('vitest').beforeEach
let afterEach: typeof import('vitest').afterEach
try {
  const mod = await import('vitest')
  beforeEach = mod.beforeEach
  afterEach = mod.afterEach
} catch (e) {
  throw new MissingPeerDependencyError(
    'shell-cassette/vitest requires vitest as a peer dependency.\n\n' +
      'Install it:\n' +
      '  npm install --save-dev vitest\n' +
      '  pnpm add --save-dev vitest\n' +
      '  yarn add --dev vitest\n\n' +
      `Original error: ${e instanceof Error ? e.message : String(e)}`,
  )
}

// Register both hooks under one try/catch. If vitest externalized us, both
// registration calls throw with the same root cause; one wrap is enough.
try {
  beforeEach((ctx) => {
    const task = (ctx as { task?: unknown }).task as
      | Parameters<typeof deriveCassettePathFromTask>[0]
      | undefined
    if (!task) return

    const config = getConfig()
    let cassettePath: string
    try {
      cassettePath = deriveCassettePathFromTask(task, config.cassetteDir)
    } catch (e) {
      if (e instanceof ConcurrencyError) {
        throw e
      }
      return
    }

    registerSessionPath(cassettePath, `vitest-plugin:${task.name}`)

    const session: CassetteSession = {
      name: task.name,
      path: cassettePath,
      scopeDefault: 'auto',
      loadedFile: null,
      matcher: null,
      newRecordings: [],
      redactedKeys: [],
      warnings: [],
    }
    setActiveCassette(session)
  })

  afterEach(async () => {
    const session = getActiveCassette()
    if (session && session.newRecordings.length > 0) {
      const existingRecordings = session.loadedFile?.recordings ?? []
      const merged = {
        version: 1 as const,
        recordings: [...existingRecordings, ...session.newRecordings],
      }
      await writeCassetteFile(session.path, serialize(merged))
    }
    if (session) {
      summarizeSession(session)
      unregisterSessionPath(session.path)
    }
    clearActiveCassette()
  })
} catch (e) {
  throw wrapRegistrationError(e)
}
