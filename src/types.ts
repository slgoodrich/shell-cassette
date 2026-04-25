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
  // Captured only when the original call passed { all: true }; null otherwise.
  // Replay falls back to stdout+stderr concat if a caller asks for `all` but the recording is null.
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
}

// Forward-declared interface; implemented in matcher.ts
export interface MatcherStateLike {
  findMatch(call: Call): Recording | null
}
