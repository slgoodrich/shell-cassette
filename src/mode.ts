import type { Mode } from './types.js'

const VALID_MODES: ReadonlySet<Mode> = new Set(['record', 'replay', 'auto', 'passthrough'])

export function resolveMode(
  envVar: string | undefined,
  isCI: boolean,
  scopeDefault: 'auto' | 'passthrough',
): Mode {
  if (envVar && VALID_MODES.has(envVar as Mode)) {
    return envVar as Mode
  }
  if (isCI) {
    return 'replay'
  }
  return scopeDefault
}
