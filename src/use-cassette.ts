import path from 'node:path'
import { writeCassetteFile } from './io.js'
import { serialize } from './serialize.js'
import {
  registerSessionPath,
  unregisterSessionPath,
  withCassette as withCassetteScope,
} from './state.js'
import { summarizeSession } from './summary.js'
import type { CassetteFile, CassetteSession } from './types.js'

export async function useCassette<T>(cassettePath: string, fn: () => Promise<T>): Promise<T> {
  const absolutePath = path.resolve(cassettePath)
  registerSessionPath(absolutePath, `useCassette(${cassettePath})`)
  try {
    const session: CassetteSession = {
      name: path.basename(cassettePath),
      path: absolutePath,
      scopeDefault: 'auto',
      loadedFile: null,
      matcher: null,
      newRecordings: [],
      redactedKeys: [],
      warnings: [],
    }

    return await withCassetteScope(session, async () => {
      try {
        return await fn()
      } finally {
        await persistSession(session)
        summarizeSession(session)
      }
    })
  } finally {
    unregisterSessionPath(absolutePath)
  }
}

async function persistSession(session: CassetteSession): Promise<void> {
  if (session.newRecordings.length === 0) return

  const existingRecordings = session.loadedFile?.recordings ?? []
  const merged: CassetteFile = {
    version: 1,
    recordings: [...existingRecordings, ...session.newRecordings],
  }
  const json = serialize(merged)
  await writeCassetteFile(session.path, json)
}
