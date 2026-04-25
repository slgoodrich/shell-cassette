import { afterEach, beforeEach } from 'vitest'
import { getConfig } from './config.js'
import { ConcurrencyError } from './errors.js'
import { writeCassetteFile } from './io.js'
import { deriveCassettePathFromTask } from './plugin.js'
import { serialize } from './serialize.js'
import {
  clearActiveCassette,
  registerSessionPath,
  setActiveCassette,
  unregisterSessionPath,
} from './state.js'
import type { CassetteSession } from './types.js'

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
    unregisterSessionPath(session.path)
  }
  clearActiveCassette()
})
