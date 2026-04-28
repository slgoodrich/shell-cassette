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
  /**
   * Per-recording redaction summary. v2 schema. v1 cassettes load with `[]`.
   * Aggregated by (rule, source) at record time. Used by CLI tooling
   * (scan, show, re-redact) for header summaries and counter ceiling
   * computation without walking the body.
   */
  redactions: RedactionEntry[]
}

export type CassetteFile = {
  version: 1 | 2
  /**
   * Top-level metadata: which shell-cassette version recorded this cassette.
   * v0.4+ writes `{ name, version }`; loaded as `null` for v1 cassettes that
   * predate the field.
   */
  recordedBy: { name: string; version: string } | null
  recordings: Recording[]
}

export type Canonicalize = (call: Call, redactConfig: Readonly<RedactConfig>) => Partial<Call>

export type RedactSource = 'env' | 'args' | 'stdout' | 'stderr' | 'allLines'

export type RedactRule = {
  /**
   * Stable kebab-case identifier. API-stable: rule names ship locked at v0.4 and
   * are never renamed. New patterns may be added additively (any version);
   * removing or renaming is a breaking change.
   */
  name: string
  /**
   * Regex for shape detection or a transform function for advanced cases where
   * the user wants full control over the replacement. The pipeline normalizes
   * regex patterns by ensuring the `g` flag is set at call time, so user-supplied
   * regex may be supplied with or without the `g` flag.
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

type SessionBase = {
  name: string
  path: string
  scopeDefault: 'auto' | 'passthrough'
  canonicalize: Canonicalize
  /**
   * Frozen redaction config for this session. Loaded from Config.redact.
   * Per-cassette override of redact: false is wired via redactEnabled.
   */
  redactConfig: Readonly<RedactConfig>
  /**
   * When false (set via useCassette({ redact: false })), the recorder
   * bypasses the redact pipeline. Default true.
   */
  redactEnabled: boolean
  /**
   * Mutable counter map: key is `${source}:${rule}`. Incremented on each
   * placeholder emission during recording. Seeded from existing cassette
   * placeholders on cassette load (so auto-additive appends continue from
   * the existing ceiling).
   */
  redactCounters: Map<string, number>
  /**
   * Accumulated across all redact() calls in this session. Used for summary
   * logging at session end.
   */
  redactionEntries: RedactionEntry[]
  newRecordings: Recording[]
  warnings: string[]
}

/**
 * Session before lazy-load: the cassette file has not been read yet and
 * the matcher has not been initialized. Both fields are null.
 */
export type PendingSession = SessionBase & {
  matcher: null
  loadedFile: null
}

/**
 * Session after lazy-load: the matcher is initialized (non-null). The
 * cassette file may still be null when recording into a brand-new cassette.
 */
export type LoadedSession = SessionBase & {
  matcher: MatcherStateLike
  loadedFile: CassetteFile | null
}

/**
 * Discriminated union over lazy-load state. Discriminant is `matcher`:
 *   null  => PendingSession (pre-lazy-load)
 *   non-null => LoadedSession (post-lazy-load)
 */
export type CassetteSession = PendingSession | LoadedSession

// Forward-declared interface; implemented in matcher.ts
export interface MatcherStateLike {
  findMatch(call: Call): Recording | null
}
