import { log } from './log.js'
import { type RedactConfig, redactEnv } from './redact.js'
import type { Call, CassetteSession, Result } from './types.js'

export function record(
  call: Call,
  result: Result,
  session: CassetteSession,
  config: RedactConfig,
): void {
  const { redacted, redactedKeys, warnings } = redactEnv(call.env, config)

  for (const key of redactedKeys) {
    log(`redacted env var ${key} → ${session.path}`)
    session.redactedKeys.push(key)
  }
  for (const warning of warnings) {
    log(warning)
    session.warnings.push(warning)
  }

  session.newRecordings.push({
    call: { ...call, env: redacted },
    result,
  })
}
