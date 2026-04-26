// shell-cassette/vitest plugin: registers global beforeEach/afterEach hooks
// for auto-cassetting per test.
//
// SETUP REQUIREMENT: when shell-cassette is installed as a node_modules
// dependency, vitest externalizes it by default and the hook registration
// at module top level fails with "Vitest failed to find the runner."
// Add 'shell-cassette' to test.server.deps.inline in your vitest config:
//
//   test: { server: { deps: { inline: ['shell-cassette'] } } }
//
// See docs/vitest-plugin.md for details. This is the standard vitest plugin
// pattern and applies to vitest 3.x and 4.x.

import { getConfig } from './config.js'
import { ConcurrencyError, MissingPeerDependencyError } from './errors.js'
import { writeCassetteFile } from './io.js'
import { deriveCassettePathFromTask } from './plugin.js'
import { serialize } from './serialize.js'
import {
  clearActiveCassette,
  registerSessionPath,
  setActiveCassette,
  unregisterSessionPath,
} from './state.js'
import { summarizeSession } from './summary.js'
import type { CassetteSession } from './types.js'

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
      `Original error: ${(e as Error).message}`,
  )
}

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
  const { getActiveCassette } = await import('./state.js')
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
