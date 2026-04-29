import { BinaryOutputError, CassetteCorruptError } from './errors.js'
import type { CassetteFile, Recording, RedactionEntry, SuppressedEntry } from './types.js'

const SCHEMA_VERSION = 2

const REVIEW_WARNING =
  'REVIEW BEFORE COMMITTING. shell-cassette redacts bundled credential patterns + ' +
  'curated env-key values + your custom rules. It does NOT redact: AWS Secret Access Keys, ' +
  'JWTs (without opt-in), encoded credentials, binary output, cwd, stdin. ' +
  'Run `shell-cassette scan <path>` to verify before committing. ' +
  'See https://github.com/slgoodrich/shell-cassette/blob/main/docs/troubleshooting.md'

/**
 * Serialize a CassetteFile to JSON. Always emits SCHEMA_VERSION (currently 2)
 * regardless of `file.version` — serialize is upgrade-on-write. A v1 cassette
 * passed in is materialized as v2 on disk; deserialize handles the inverse
 * by accepting v1 input and normalizing missing fields.
 *
 * `file.recordedBy` is the single source of truth for the cassette's recorder
 * identity. Production callers populate it with { name, version } from
 * package.json; tools constructing cassettes manually may set it to null.
 */
export function serialize(file: CassetteFile): string {
  validateBeforeSerialize(file)
  // Build object in canonical key order for stable diffs.
  // _warning is an additive optional field meant for code-review eyeballs:
  // anyone reading the cassette JSON sees the redaction caveat at the top
  // even if they never saw the stderr log when it was recorded.
  // Underscore prefix marks it as metadata (deserialize ignores unknown fields).
  const ordered = {
    version: SCHEMA_VERSION,
    _warning: REVIEW_WARNING,
    _recorded_by: file.recordedBy,
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
      aborted: rec.result.aborted,
    },
    _redactions: rec.redactions,
    ...(rec.suppressed.length > 0 ? { _suppressed: rec.suppressed } : {}),
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
  const version = obj.version
  if (version !== 1 && version !== 2) {
    throw new CassetteCorruptError(
      `cassette version ${version} unknown; expected 1 or 2. ` +
        `If recorded with a newer shell-cassette, upgrade. Otherwise delete and re-record.`,
    )
  }
  if (!Array.isArray(obj.recordings)) {
    throw new CassetteCorruptError('cassette `recordings` must be an array')
  }

  const recordings = (obj.recordings as LegacyRecording[]).map(normalizeRecording)
  const recordedByObj =
    version === 2 && obj._recorded_by && typeof obj._recorded_by === 'object'
      ? (obj._recorded_by as Record<string, unknown>)
      : null
  const recordedBy =
    recordedByObj &&
    typeof recordedByObj.name === 'string' &&
    typeof recordedByObj.version === 'string'
      ? { name: recordedByObj.name, version: recordedByObj.version }
      : null

  return {
    version: version as 1 | 2,
    recordedBy,
    recordings,
  }
}

// Fields added after the v2 schema landed are optional on disk;
// normalizeRecording fills defaults.
type LegacyRecording = {
  call: Recording['call']
  result: Omit<Recording['result'], 'allLines' | 'aborted'> & {
    allLines?: string[] | null
    aborted?: boolean
  }
  _redactions?: RedactionEntry[]
  _suppressed?: SuppressedEntry[]
}

function normalizeRecording(rec: LegacyRecording): Recording {
  return {
    call: rec.call,
    result: {
      ...rec.result,
      allLines: rec.result.allLines ?? null,
      aborted: rec.result.aborted ?? false,
    },
    redactions: rec._redactions ?? [],
    suppressed: rec._suppressed ?? [],
  }
}
