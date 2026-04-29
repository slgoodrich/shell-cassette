import { BUNDLED_PATTERNS as _BUNDLED } from './redact-patterns.js'
import {
  type RedactInput,
  type RedactOptions,
  type RedactOutput,
  runPipeline,
} from './redact-pipeline.js'
import type { RedactConfig, RedactionEntry, RedactRule, RedactSource } from './types.js'

export const BUNDLED_PATTERNS: readonly RedactRule[] = _BUNDLED

export type { RedactInput, RedactOptions, RedactOutput }

/**
 * Apply the redact pipeline to a single value.
 *
 * The recorder calls this at record time with `counted: true` to produce
 * counter-tagged placeholders persisted to the cassette. The canonicalize
 * pipeline calls this at match time with `counted: false` so deep-equal
 * works across cassette args containing redacted credentials.
 *
 * Custom rules in `config.customPatterns` may use either a global regex
 * (matched via String.prototype.replace) or a transform function (called
 * once with the input value, returning the replacement). Suppress patterns
 * checked first; bundled patterns next; custom patterns last; length warning
 * fires only when no rule fired.
 */
export function redact(
  input: RedactInput,
  config: Readonly<RedactConfig>,
  options: RedactOptions,
): RedactOutput {
  return runPipeline(input, config, options)
}

export type { RedactConfig, RedactionEntry, RedactRule, RedactSource }
