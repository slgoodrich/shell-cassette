import { log } from './log.js'
import type { CassetteSession } from './types.js'

/**
 * Emit a grouped end-of-run summary listing redactions and warnings
 * accumulated during this cassette session. Called by the vitest plugin's
 * afterEach and useCassette's finally block when a session ends.
 *
 * Only emits when there's something worth surfacing: new recordings written,
 * redactions performed, or warnings logged. Pure-replay sessions stay silent.
 */
export function summarizeSession(session: CassetteSession): void {
  const recCount = session.newRecordings.length
  const redCount = session.redactedKeys.length
  const warnCount = session.warnings.length

  if (recCount === 0 && redCount === 0 && warnCount === 0) {
    return
  }

  log(
    `cassette saved (${recCount} recording${recCount === 1 ? '' : 's'}, ` +
      `${redCount} redaction${redCount === 1 ? '' : 's'}, ` +
      `${warnCount} warning${warnCount === 1 ? '' : 's'}): ${session.path}`,
  )

  for (const key of session.redactedKeys) {
    log(`  redacted: ${key}`)
  }
  for (const warning of session.warnings) {
    log(`  ⚠️  ${warning}`)
  }
}
