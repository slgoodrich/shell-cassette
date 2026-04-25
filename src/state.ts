import { AsyncLocalStorage } from 'node:async_hooks'
import { CassetteCollisionError } from './errors.js'
import type { CassetteSession } from './types.js'

const als = new AsyncLocalStorage<CassetteSession>()
let moduleGlobalSession: CassetteSession | null = null
const openSessions = new Map<string, string>()

export function getActiveCassette(): CassetteSession | null {
  const alsSession = als.getStore()
  if (alsSession !== undefined) return alsSession
  return moduleGlobalSession
}

export function setActiveCassette(session: CassetteSession): void {
  moduleGlobalSession = session
}

export function clearActiveCassette(): void {
  moduleGlobalSession = null
}

export async function withCassette<T>(session: CassetteSession, fn: () => Promise<T>): Promise<T> {
  return als.run(session, fn)
}

export function registerSessionPath(path: string, opener: string): void {
  const existing = openSessions.get(path)
  if (existing !== undefined) {
    throw new CassetteCollisionError(
      `cassette path ${path} is already open in this process (opened by ${existing}); attempted re-open by ${opener}. Concurrent useCassette calls cannot share a cassette file.`,
    )
  }
  openSessions.set(path, opener)
}

export function unregisterSessionPath(path: string): void {
  openSessions.delete(path)
}

// Test-only reset (NOT exported through index.ts)
export function _resetForTesting(): void {
  moduleGlobalSession = null
  openSessions.clear()
}
