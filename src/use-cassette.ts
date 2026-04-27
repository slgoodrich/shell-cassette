import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

const PACKAGE_VERSION = (
  JSON.parse(
    readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'),
      'utf8',
    ),
  ) as { version: string }
).version

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
    const session: CassetteSession = {
      name: path.basename(cassettePath),
      path: absolutePath,
      scopeDefault: 'auto',
      loadedFile: null,
      matcher: null,
      canonicalize,
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
    version: 2,
    recordedBy: { name: 'shell-cassette', version: PACKAGE_VERSION },
    recordings: [...existingRecordings, ...session.newRecordings],
  }
  const json = serialize(merged)
  await writeCassetteFile(session.path, json)
}
