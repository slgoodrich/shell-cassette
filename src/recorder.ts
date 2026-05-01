import { CURATED_ENV_KEYS } from './curated-env-keys.js'
import { log } from './log.js'
import { redact } from './redact.js'
import { aggregateEntries, ENV_KEY_MATCH_RULE, formatPlaceholder } from './redact-pipeline.js'
import type { Call, CassetteSession, Recording, RedactSource, Result } from './types.js'

export function record(call: Call, result: Result, session: CassetteSession): void {
  // Compile-time exhaustiveness: redactCall covers env+args+stdin and
  // redactResult covers stdout+stderr+allLines. Adding a new RedactSource
  // variant must extend one of those two. This assertion fires in both
  // subfunctions if a variant goes unhandled here.
  type _CoveredSources = 'env' | 'args' | 'stdin' | 'stdout' | 'stderr' | 'allLines'
  const _exhaustive: Exclude<RedactSource, _CoveredSources> extends never ? true : never = true
  void _exhaustive

  if (!session.redactEnabled) {
    // Per-cassette override: bypass the redact pipeline entirely.
    session.newRecordings.push({ call, result, redactions: [], suppressed: [] })
    return
  }

  // Snapshot redactionEntries length to identify entries added during this
  // single capture.
  const before = session.redactionEntries.length

  const redactedCall = redactCall(call, session)
  const redactedResult = redactResult(result, session)

  const recordingEntries = session.redactionEntries.slice(before)
  const aggregated = aggregateEntries(recordingEntries)

  session.newRecordings.push({
    call: redactedCall,
    result: redactedResult,
    redactions: aggregated,
    suppressed: [],
  })
}

function redactCall(call: Call, session: CassetteSession): Call {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(call.env)) {
    if (matchesEnvKeyList(key, session.redactConfig.envKeys)) {
      // Curated key match: whole value is sensitive; use the env-key-match rule.
      const counterKey = `env:${ENV_KEY_MATCH_RULE}`
      const next = (session.redactCounters.get(counterKey) ?? 0) + 1
      session.redactCounters.set(counterKey, next)
      env[key] = formatPlaceholder('env', ENV_KEY_MATCH_RULE, next)
      session.redactionEntries.push({ rule: ENV_KEY_MATCH_RULE, source: 'env', count: 1 })
      log(`redacted env var ${key} → ${session.path}`)
    } else {
      // Value-based: run through the pipeline for pattern-based detection.
      const r = redact({ source: 'env', key, value }, session.redactConfig, {
        counted: true,
        counters: session.redactCounters,
      })
      env[key] = r.output
      session.redactionEntries.push(...r.entries)
      session.warnings.push(...r.warnings)
    }
  }

  const args = call.args.map((arg) => redactLine('args', arg, session))

  // Stdin can carry credentials (raw API responses with embedded tokens,
  // hand-typed credentials, etc.) that no env-key match would catch.
  // Run the bundled + custom regex pipeline against the raw stdin string
  // when present; skip entirely for null stdin (no input was supplied).
  const stdin = call.stdin === null ? null : redactLine('stdin', call.stdin, session)

  return { ...call, env, args, stdin }
}

function redactResult(result: Result, session: CassetteSession): Result {
  return {
    ...result,
    stdoutLines: result.stdoutLines.map((line) => redactLine('stdout', line, session)),
    stderrLines: result.stderrLines.map((line) => redactLine('stderr', line, session)),
    allLines: result.allLines?.map((line) => redactLine('allLines', line, session)) ?? null,
  }
}

function redactLine(source: RedactSource, line: string, session: CassetteSession): string {
  const r = redact({ source, value: line }, session.redactConfig, {
    counted: true,
    counters: session.redactCounters,
  })
  session.redactionEntries.push(...r.entries)
  session.warnings.push(...r.warnings)
  return r.output
}

export function matchesEnvKeyList(key: string, userKeys: readonly string[]): boolean {
  const upper = key.toUpperCase()
  for (const k of CURATED_ENV_KEYS) {
    if (upper.includes(k.toUpperCase())) return true
  }
  for (const k of userKeys) {
    if (upper.includes(k.toUpperCase())) return true
  }
  return false
}

// Re-export Recording type for callers that previously imported it from here.
export type { Recording }
