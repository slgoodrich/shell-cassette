import path from 'node:path'
import { getConfig } from './config.js'
import { writeCassetteFile } from './io.js'
import { defaultCanonicalize } from './matcher.js'
import { serialize } from './serialize.js'
import {
  registerSessionPath,
  unregisterSessionPath,
  withCassette as withCassetteScope,
} from './state.js'
import { summarizeSession } from './summary.js'
import type { Canonicalize, CassetteFile, CassetteSession, UseCassetteOptions } from './types.js'
import { RECORDED_BY } from './version.js'

// Public overloads
export function useCassette<T>(cassettePath: string, fn: () => Promise<T>): Promise<T>
export function useCassette<T>(
  cassettePath: string,
  options: UseCassetteOptions,
  fn: () => Promise<T>,
): Promise<T>
// Implementation
export async function useCassette<T>(
  cassettePath: string,
  fnOrOptions: UseCassetteOptions | (() => Promise<T>),
  maybeFn?: () => Promise<T>,
): Promise<T> {
  const options: UseCassetteOptions = typeof fnOrOptions === 'function' ? {} : fnOrOptions
  const fn: () => Promise<T> =
    typeof fnOrOptions === 'function' ? fnOrOptions : (maybeFn as () => Promise<T>)
  const canonicalize: Canonicalize = options.canonicalize ?? defaultCanonicalize

  const absolutePath = path.resolve(cassettePath)
  registerSessionPath(absolutePath, `useCassette(${cassettePath})`)
  try {
    const config = getConfig()
    const session: CassetteSession = {
      name: path.basename(cassettePath),
      path: absolutePath,
      scopeDefault: 'auto',
      loadedFile: null,
      matcher: null,
      canonicalize,
      redactConfig: config.redact,
      redactEnabled: options.redact !== false,
      redactCounters: new Map(),
      redactionEntries: [],
      newRecordings: [],
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
    version: 2,
    recordedBy: RECORDED_BY,
    recordings: [...existingRecordings, ...session.newRecordings],
  }
  const json = serialize(merged)
  await writeCassetteFile(session.path, json)
}
