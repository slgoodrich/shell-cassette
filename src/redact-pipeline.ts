import { ShellCassetteError } from './errors.js'
import { BUNDLED_PATTERNS } from './redact-patterns.js'
import type {
  CassetteFile,
  RedactConfig,
  RedactionEntry,
  RedactRule,
  RedactSource,
} from './types.js'

export type RedactInput = {
  source: RedactSource
  value: string
}

/**
 * Discriminated union over counter mode. Restructured from the spec's
 * `{ counted: boolean; counters?: Map<string, number> }` shape so the
 * unreachable state `counted: true && counters: undefined` cannot be
 * expressed; callers in counted mode must supply the counters Map.
 *
 * Per `.claude/rules/error_handling.md` "Internal Invariants": restructure
 * types so unreachable states can't be expressed in preference to runtime
 * non-null assertions.
 */
export type RedactOptions = { counted: false } | { counted: true; counters: Map<string, number> }

export type RedactOutput = {
  output: string
  entries: RedactionEntry[]
  warnings: string[]
}

// Module-level cache: build g-flagged copies once at module load.
// BUNDLED_PATTERNS stores patterns without the g flag (stateless, safe for .test()/.exec()).
// The pipeline adds the g flag here so String.prototype.replace iterates all matches.

// Bundled patterns are RegExp-only by contract (see redact-patterns.ts and the
// structural test in tests/unit/redact-patterns.test.ts). Validate at module
// load so a future function-typed addition fails fast and visibly (rather than
// being silently filtered out).
for (const rule of BUNDLED_PATTERNS) {
  if (!(rule.pattern instanceof RegExp)) {
    throw new ShellCassetteError(
      `bundled rule "${rule.name}" has a non-RegExp pattern; bundle is RegExp-only (internal bug; should be unreachable)`,
    )
  }
}

const G_FLAGGED_BUNDLE: { name: string; pattern: RegExp }[] = BUNDLED_PATTERNS.filter(
  (r): r is RedactRule & { pattern: RegExp } => r.pattern instanceof RegExp,
).map((r) => ({
  name: r.name,
  pattern: new RegExp(r.pattern.source, `${r.pattern.flags}g`),
}))

const PATH_OR_WHITESPACE_REGEX = /[/\\: ]/

/**
 * Apply the redact pipeline to a single value.
 *
 * Phases run in this fixed order:
 *
 *   1. Suppress: if any regex in `config.suppressPatterns` matches the input
 *      value, the value is exempt from all subsequent phases (short-circuit).
 *      Use case: project-wide fake-token fixtures.
 *   2. Bundled patterns: when `config.bundledPatterns` is true, every rule in
 *      `BUNDLED_PATTERNS` (with the `g` flag added by the pipeline) runs against
 *      the working value. Each match is replaced by a placeholder.
 *   3. Custom patterns: each rule in `config.customPatterns` runs after bundled.
 *      Regex patterns are normalized so the `g` flag is set; function patterns
 *      are called once and counted as one match if they transform.
 *   4. Length warning: fires only when the output is identity-equal to the
 *      input (no rule fired) AND output length exceeds
 *      `config.warnLengthThreshold` AND (`warnPathHeuristic` is false OR the
 *      value contains no `/`, `\`, `:`, or space). Surfaces a candidate
 *      credential not caught by any rule.
 *
 * Output mode is set by `options.counted`:
 *   - `true`: emit `<redacted:source:rule:N>` placeholders. Counter is per
 *     `(source, rule)` pair, drawn from `options.counters`. Used at record time
 *     so cassette content has stable, greppable provenance.
 *   - `false`: emit `<redacted:source:rule>` placeholders (no counter). Used at
 *     canonicalize / match time so cassette args containing counter-tagged
 *     placeholders deep-equal against fresh-call args.
 */
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
      // User-supplied regex may omit the g flag; pipeline requires it for
      // String.prototype.replace to iterate all matches in a value.
      const gPattern = rule.pattern.flags.includes('g')
        ? rule.pattern
        : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`)
      output = applyRegexRule(output, rule.name, gPattern, input.source, options, entries)
    }
  }

  const noRuleFired = output === value
  const exceedsThreshold = output.length > config.warnLengthThreshold
  const suppressedByHeuristic = config.warnPathHeuristic && PATH_OR_WHITESPACE_REGEX.test(output)

  if (noRuleFired && exceedsThreshold && !suppressedByHeuristic) {
    warnings.push(
      `${input.source} value (${output.length} chars) exceeds threshold ${config.warnLengthThreshold} ` +
        `and contains no path/whitespace characters; may be a credential not in any rule. ` +
        `Review or add a pattern to config.redact.customPatterns.`,
    )
  }

  return { output, entries, warnings }
}

export function formatPlaceholder(source: RedactSource, ruleName: string, count?: number): string {
  return count === undefined
    ? `<redacted:${source}:${ruleName}>`
    : `<redacted:${source}:${ruleName}:${count}>`
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
      const key = `${source}:${ruleName}`
      const next = (options.counters.get(key) ?? 0) + 1
      options.counters.set(key, next)
      return formatPlaceholder(source, ruleName, next)
    }
    return formatPlaceholder(source, ruleName)
  })
  if (count > 0) {
    entries.push({ rule: ruleName, source, count })
  }
  return result
}

// Single source of truth for the counter-placeholder pattern. Both
// stripCounter and walkStringsForPlaceholders construct g-flagged RegExp
// instances from this string so lastIndex state never leaks between callers.
const COUNTER_PLACEHOLDER_PATTERN = '<redacted:([^:>]+):([^:>]+):(\\d+)>'

/**
 * Replace counter-tagged placeholders with their counter-stripped form.
 * Used by the canonicalize pipeline at match time so cassette args containing
 * counter-tagged placeholders deep-equal against fresh-call args canonicalized
 * in stripped mode. Stripped placeholders pass through unchanged.
 */
export function stripCounter(s: string): string {
  return s.replace(new RegExp(COUNTER_PLACEHOLDER_PATTERN, 'g'), '<redacted:$1:$2>')
}

/**
 * Build a counter map seeded from existing placeholders in a loaded cassette.
 *
 * Two sources are walked:
 *   1. Each recording's `redactions` metadata: (rule, source, count) triples
 *      contribute to the per-(source, rule) counter ceiling.
 *   2. Every value (env, args, stdout, stderr, allLines) is scanned for
 *      counter-tagged placeholders. The maximum N seen for each
 *      (source, rule) pair becomes the ceiling. This catches hand-edited
 *      cassettes where the metadata is stale or out-of-sync with the body.
 *
 * The returned Map is the seed for `CassetteSession.redactCounters`. New
 * placeholders emitted during auto-additive appends start at
 * `max(seeded) + 1` per (source, rule), continuing the existing counter
 * sequence.
 */
export function seedCountersFromCassette(cassette: CassetteFile): Map<string, number> {
  const counters = new Map<string, number>()

  // Source 1: per-recording _redactions metadata. Each entry.count is the
  // number of placeholder occurrences within that single recording. The
  // cassette-wide ceiling is the SUM across recordings — counters are
  // monotonic and per-(source, rule) globally.
  for (const rec of cassette.recordings) {
    for (const entry of rec.redactions) {
      const key = `${entry.source}:${entry.rule}`
      counters.set(key, (counters.get(key) ?? 0) + entry.count)
    }
  }

  // Source 2: walk every string value for counter-tagged placeholders
  for (const rec of cassette.recordings) {
    walkStringsForPlaceholders(rec, (source, rule, n) => {
      const key = `${source}:${rule}`
      const existing = counters.get(key) ?? 0
      if (n > existing) counters.set(key, n)
    })
  }

  return counters
}

function walkStringsForPlaceholders(
  rec: CassetteFile['recordings'][number],
  visit: (source: string, rule: string, n: number) => void,
): void {
  // Construct the regex once per function call. String.prototype.matchAll
  // does not mutate the pattern's lastIndex, so reusing re across multiple
  // matchAll calls is safe.
  const re = new RegExp(COUNTER_PLACEHOLDER_PATTERN, 'g')
  const values = [
    ...Object.values(rec.call.env),
    ...rec.call.args,
    ...rec.result.stdoutLines,
    ...rec.result.stderrLines,
    ...(rec.result.allLines ?? []),
  ]
  for (const value of values) {
    for (const m of value.matchAll(re)) {
      // Groups 1-3 are always present given the pattern shape; non-null safe.
      // biome-ignore lint/style/noNonNullAssertion: regex groups are structural
      visit(m[1]!, m[2]!, parseInt(m[3]!, 10))
    }
  }
}

/**
 * Synthetic rule name for the recorder's curated env-key-match path
 * (env values whose key name matches the CURATED_ENV_KEYS or user-supplied
 * envKeys list). Not in BUNDLED_PATTERNS — the env-key pathway bypasses the
 * regex pipeline since the whole value is sensitive.
 */
export const ENV_KEY_MATCH_RULE = 'env-key-match'

/**
 * Collapse a flat array of RedactionEntry into one entry per (source, rule)
 * by summing counts. Used at record time to produce per-recording redaction
 * metadata, and by re-redact (M11) to rebuild metadata after re-applying
 * rules.
 */
export function aggregateEntries(entries: readonly RedactionEntry[]): RedactionEntry[] {
  const map = new Map<string, RedactionEntry>()
  for (const e of entries) {
    const key = `${e.source}:${e.rule}`
    const existing = map.get(key)
    if (existing) {
      existing.count += e.count
    } else {
      map.set(key, { ...e })
    }
  }
  return [...map.values()]
}
