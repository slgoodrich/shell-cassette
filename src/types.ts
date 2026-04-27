export type Mode = 'record' | 'replay' | 'auto' | 'passthrough'

export type Call = {
  command: string
  args: readonly string[]
  cwd: string | null
  env: Record<string, string>
  stdin: null // v0.1: stdin not supported
}

export type Result = {
  stdoutLines: string[]
  stderrLines: string[]
  // null when the original call did not pass { all: true }
  allLines: string[] | null
  exitCode: number
  signal: string | null
  durationMs: number
  // True when the original call was cancelled (execa: r.isCanceled,
  // tinyexec: r.aborted). Defaults to false on legacy cassettes that
  // predate the field; deserializer normalizes.
  aborted: boolean
}

export type Recording = {
  call: Call
  result: Result
}

export type CassetteFile = {
  version: 1
  recordings: Recording[]
}

export type Canonicalize = (call: Call) => Partial<Call>

export type RedactSource = 'env' | 'args' | 'stdout' | 'stderr' | 'allLines'

export type RedactRule = {
  /**
   * Stable kebab-case identifier. API-stable: rule names ship locked at v0.4 and
   * are never renamed. New patterns may be added additively (any version);
   * removing or renaming is a breaking change.
   */
  name: string
  /**
   * Either a global regex (most rules) or a transform function (for advanced
   * cases where the user wants full control over the replacement). Regex rules
   * use `String.prototype.matchAll` semantics; the regex MUST have the `g` flag.
   */
  pattern: RegExp | ((s: string) => string)
  /**
   * Optional human-readable description. Used by `shell-cassette show` and
   * documentation generators.
   */
  description?: string
}

/**
 * One entry per (source, rule) combination that fired during a redaction pass.
 * Persisted as the `_redactions` JSON field on each cassette recording.
 */
export type RedactionEntry = {
  rule: string // matches RedactRule.name
  source: RedactSource
  count: number // number of placeholder occurrences for this (source, rule) in this recording
}

export type RedactConfig = {
  /**
   * When true, the bundled credential patterns from `BUNDLED_PATTERNS` apply.
   * Set false to opt out of all bundled detection (custom patterns and suppress
   * list still apply).
   */
  bundledPatterns: boolean
  /**
   * User-supplied custom rules. Apply after bundled rules. Each rule's `name`
   * field appears in placeholder strings (`<redacted:source:NAME:N>`).
   */
  customPatterns: readonly RedactRule[]
  /**
   * Suppress list. Checked FIRST, before bundled and custom rules. If any
   * suppress regex matches the input value, the value is exempt from all
   * redaction (including the length warning). Use case: project-wide
   * fake-token fixtures the bundle would otherwise scrub.
   */
  suppressPatterns: readonly RegExp[]
  /**
   * User extension to the curated env-key match list. Treated as
   * case-insensitive substring match against env var key names (matches
   * v0.2/v0.3 behavior for the curated list).
   */
  envKeys: readonly string[]
  /**
   * Length above which an unredacted value triggers a long-value warning.
   * Tuned to catch GitHub PATs, OpenAI keys, Stripe restricted, AWS Secret
   * Access Keys without nagging on common path env vars.
   */
  warnLengthThreshold: number
  /**
   * When true, values containing `/`, `\`, `:`, or ` ` (space) suppress the
   * length warning. Catches the common false-positive case (paths, configs,
   * connection strings) without missing bare credential strings.
   */
  warnPathHeuristic: boolean
}

export type UseCassetteOptions = {
  canonicalize?: Canonicalize
  /**
   * Per-cassette redaction toggle. Set false for cassettes that legitimately
   * need raw stdout/args (e.g., tests asserting on CLI output that happens to
   * contain credential-shaped strings as test fixtures, NOT real credentials).
   * The boolean is intentionally coarse-grained; per-stream toggling is not
   * supported.
   */
  redact?: boolean
}

export type CassetteSession = {
  name: string
  path: string
  scopeDefault: 'auto' | 'passthrough'
  loadedFile: CassetteFile | null
  matcher: MatcherStateLike | null // built lazily; defined in matcher.ts
  canonicalize: Canonicalize
  newRecordings: Recording[]
  // Accumulated across record() calls in this scope. Emitted as an
  // end-of-run summary by the vitest plugin and useCassette finally.
  redactedKeys: string[]
  warnings: string[]
}

// Forward-declared interface; implemented in matcher.ts
export interface MatcherStateLike {
  findMatch(call: Call): Recording | null
}
