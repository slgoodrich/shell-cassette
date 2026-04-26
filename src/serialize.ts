import { BinaryOutputError, CassetteCorruptError } from './errors.js'
import type { CassetteFile, Recording } from './types.js'

const SCHEMA_VERSION = 1

const REVIEW_WARNING =
  'REVIEW BEFORE COMMITTING. shell-cassette redacts curated env-key values; ' +
  'it does NOT redact stdout, stderr, args, or env vars with non-curated names. ' +
  'See https://github.com/slgoodrich/shell-cassette/blob/main/docs/troubleshooting.md#what-shell-cassette-does-not-redact'

export function serialize(file: CassetteFile): string {
  validateBeforeSerialize(file)
  // Build object in canonical key order for stable diffs.
  // _warning is an additive optional field meant for code-review eyeballs:
  // anyone reading the cassette JSON sees the redaction caveat at the top
  // even if they never saw the stderr log when it was recorded.
  // Underscore prefix marks it as metadata (deserialize ignores unknown fields).
  const ordered = {
    version: file.version,
    _warning: REVIEW_WARNING,
    recordings: file.recordings.map(orderRecording),
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}

function orderRecording(rec: Recording) {
  return {
    call: {
      command: rec.call.command,
      args: rec.call.args,
      cwd: rec.call.cwd,
      env: rec.call.env,
      stdin: rec.call.stdin,
    },
    result: {
      stdoutLines: rec.result.stdoutLines,
      stderrLines: rec.result.stderrLines,
      allLines: rec.result.allLines,
      exitCode: rec.result.exitCode,
      signal: rec.result.signal,
      durationMs: rec.result.durationMs,
    },
  }
}

function validateBeforeSerialize(file: CassetteFile): void {
  for (const rec of file.recordings) {
    for (const line of rec.result.stdoutLines) {
      if (typeof line !== 'string') {
        throw new BinaryOutputError(
          `cannot serialize non-string in stdoutLines for ${rec.call.command}; v0.1 supports UTF-8 text only`,
        )
      }
    }
    for (const line of rec.result.stderrLines) {
      if (typeof line !== 'string') {
        throw new BinaryOutputError(
          `cannot serialize non-string in stderrLines for ${rec.call.command}; v0.1 supports UTF-8 text only`,
        )
      }
    }
    if (rec.result.allLines !== null) {
      for (const line of rec.result.allLines) {
        if (typeof line !== 'string') {
          throw new BinaryOutputError(
            `cannot serialize non-string in allLines for ${rec.call.command}; v0.1 supports UTF-8 text only`,
          )
        }
      }
    }
  }
}

export function deserialize(text: string): CassetteFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new CassetteCorruptError(`invalid JSON: ${(e as Error).message}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new CassetteCorruptError('cassette must be a JSON object')
  }

  const obj = parsed as Record<string, unknown>
  if (!('version' in obj)) {
    throw new CassetteCorruptError('cassette missing `version` field')
  }
  if (obj.version !== SCHEMA_VERSION) {
    throw new CassetteCorruptError(
      `cassette version ${obj.version} unknown; expected ${SCHEMA_VERSION}. Delete and re-record.`,
    )
  }
  if (!Array.isArray(obj.recordings)) {
    throw new CassetteCorruptError('cassette `recordings` must be an array')
  }

  const recordings = (obj.recordings as LegacyRecording[]).map(normalizeLegacyRecording)
  return {
    version: SCHEMA_VERSION,
    recordings,
  }
}

// On disk, `allLines` may be absent (cassettes recorded before it existed).
type LegacyRecording = Omit<Recording, 'result'> & {
  result: Omit<Recording['result'], 'allLines'> & { allLines?: string[] | null }
}

function normalizeLegacyRecording(rec: LegacyRecording): Recording {
  if (rec.result.allLines !== undefined) return rec as Recording
  return { ...rec, result: { ...rec.result, allLines: null } }
}
