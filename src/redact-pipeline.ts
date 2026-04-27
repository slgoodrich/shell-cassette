import { BUNDLED_PATTERNS } from './redact-patterns.js'
import type { RedactConfig, RedactionEntry, RedactSource } from './types.js'

export type RedactInput = {
  source: RedactSource
  value: string
}

export type RedactOptions = { counted: false } | { counted: true; counters: Map<string, number> }

export type RedactOutput = {
  output: string
  entries: RedactionEntry[]
  warnings: string[]
}

// Module-level cache: build g-flagged copies once at module load.
// BUNDLED_PATTERNS stores patterns without the g flag (stateless, safe for .test()/.exec()).
// The pipeline adds the g flag here so String.prototype.replace iterates all matches.
const G_FLAGGED_BUNDLE: { name: string; pattern: RegExp }[] = BUNDLED_PATTERNS.filter(
  (r) => r.pattern instanceof RegExp,
).map((r) => ({
  name: r.name,
  pattern: new RegExp((r.pattern as RegExp).source, `${(r.pattern as RegExp).flags}g`),
}))

const PATH_OR_WHITESPACE_REGEX = /[/\\: ]/

export function runPipeline(
  input: RedactInput,
  config: Readonly<RedactConfig>,
  options: RedactOptions,
): RedactOutput {
  const { value } = input
  const entries: RedactionEntry[] = []
  const warnings: string[] = []

  for (const sup of config.suppressPatterns) {
    if (sup.test(value)) {
      return { output: value, entries, warnings }
    }
  }

  let output = value

  if (config.bundledPatterns) {
    for (const rule of G_FLAGGED_BUNDLE) {
      output = applyRegexRule(output, rule.name, rule.pattern, input.source, options, entries)
    }
  }

  for (const rule of config.customPatterns) {
    if (typeof rule.pattern === 'function') {
      const transformed = rule.pattern(output)
      if (transformed !== output) {
        entries.push({ rule: rule.name, source: input.source, count: 1 })
        output = transformed
      }
    } else {
      // Normalize: ensure g flag is set so all matches are replaced
      const gPattern = rule.pattern.flags.includes('g')
        ? rule.pattern
        : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`)
      output = applyRegexRule(output, rule.name, gPattern, input.source, options, entries)
    }
  }

  if (
    output === value &&
    output.length > config.warnLengthThreshold &&
    !(config.warnPathHeuristic && PATH_OR_WHITESPACE_REGEX.test(output))
  ) {
    warnings.push(
      `${input.source} value (${output.length} chars) exceeds threshold ${config.warnLengthThreshold} ` +
        `and contains no path/whitespace characters; may be a credential not in any rule. ` +
        `Review or add a pattern to config.redact.customPatterns.`,
    )
  }

  return { output, entries, warnings }
}

function applyRegexRule(
  text: string,
  ruleName: string,
  pattern: RegExp,
  source: RedactSource,
  options: RedactOptions,
  entries: RedactionEntry[],
): string {
  let count = 0
  // pattern is guaranteed to have g flag (caller ensures it)
  const result = text.replace(pattern, () => {
    count++
    if (options.counted) {
      return buildCountedPlaceholder(source, ruleName, options.counters)
    }
    return buildStrippedPlaceholder(source, ruleName)
  })
  if (count > 0) {
    entries.push({ rule: ruleName, source, count })
  }
  return result
}

function buildCountedPlaceholder(
  source: RedactSource,
  ruleName: string,
  counters: Map<string, number>,
): string {
  const key = `${source}:${ruleName}`
  const next = (counters.get(key) ?? 0) + 1
  counters.set(key, next)
  return `<redacted:${source}:${ruleName}:${next}>`
}

function buildStrippedPlaceholder(source: RedactSource, ruleName: string): string {
  return `<redacted:${source}:${ruleName}>`
}

const COUNTER_REGEX = /<redacted:([^:>]+):([^:>]+):(\d+)>/g

/**
 * Replace counter-tagged placeholders with their counter-stripped form.
 * Used by the canonicalize pipeline at match time so cassette args containing
 * counter-tagged placeholders deep-equal against fresh-call args canonicalized
 * in stripped mode. Stripped placeholders pass through unchanged.
 */
export function stripCounter(s: string): string {
  return s.replace(COUNTER_REGEX, '<redacted:$1:$2>')
}
