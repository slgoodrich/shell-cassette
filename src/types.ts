export type Mode = 'record' | 'replay' | 'auto' | 'passthrough'

export type Call = {
  command: string
  args: readonly string[]
  cwd: string | null
  env: Record<string, string>
  stdin: null // v0.1: stdin not supported
}

export type Result = {
  stdoutLines: string[]
  stderrLines: string[]
  // null when the original call did not pass { all: true }
  allLines: string[] | null
  exitCode: number
  signal: string | null
  durationMs: number
}

export type Recording = {
  call: Call
  result: Result
}

export type CassetteFile = {
  version: 1
  recordings: Recording[]
}

export type MatcherFn = (call: Call, recording: Recording) => boolean

export type CassetteSession = {
  name: string
  path: string
  scopeDefault: 'auto' | 'passthrough'
  loadedFile: CassetteFile | null
  matcher: MatcherStateLike | null // built lazily; defined in matcher.ts
  newRecordings: Recording[]
  // Accumulated across record() calls in this scope. Emitted as an
  // end-of-run summary by the vitest plugin and useCassette finally.
  redactedKeys: string[]
  warnings: string[]
}

// Forward-declared interface; implemented in matcher.ts
export interface MatcherStateLike {
  findMatch(call: Call): Recording | null
}
