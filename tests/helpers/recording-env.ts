import { afterEach, beforeEach } from 'vitest'
import type { Mode } from '../../src/types.js'
import { restoreEnv } from './env.js'

/**
 * Registers beforeEach/afterEach hooks that pin
 * SHELL_CASSETTE_ACK_REDACTION='true' and SHELL_CASSETTE_MODE around each
 * test, then restores both vars to their original values afterward.
 *
 * The default mode is 'auto' so CI=true on the runner does not force
 * replay-strict. Pass `{ mode: 'replay' }` etc. to pin a different mode.
 *
 * Usage:
 *   useRecordingEnv()                       // mode: 'auto'
 *   useRecordingEnv({ mode: 'replay' })     // pinned to replay
 */
export function useRecordingEnv(opts: { mode?: Mode } = {}): void {
  const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
  const originalMode = process.env.SHELL_CASSETTE_MODE
  const targetMode = opts.mode ?? 'auto'

  beforeEach(() => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    process.env.SHELL_CASSETTE_MODE = targetMode
  })

  afterEach(() => {
    restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
    restoreEnv('SHELL_CASSETTE_MODE', originalMode)
  })
}
