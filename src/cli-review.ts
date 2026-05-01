/**
 * `shell-cassette review` subcommand. Interactive walkthrough of unredacted
 * findings. Per-finding decisions: (a)ccept / (s)kip / (r)eplace / (d)elete /
 * (b)ack / (q)uit / (?). Decisions are batched in a pure state machine and
 * applied to the cassette on confirm.
 *
 * Output modes:
 *   - default: interactive terminal walk
 *   - --json: read-only structured listing of findings (locked at reviewVersion: 1)
 *
 * Prompt strings are not part of the API; bots should use --json instead.
 */
import {
  applyTruncation,
  color,
  previewMatch,
  setupCliColor,
  stderr,
  stdout,
} from './cli-output.js'
import { promptAction, promptText, promptYesNo } from './cli-prompt.js'
import { loadConfigFromDir, loadConfigFromFile } from './config.js'
import { CassetteConfigError, CassetteInternalError, CassetteNotFoundError } from './errors.js'
import { writeCassetteFile } from './io.js'
import { loadCassette } from './loader.js'
import { matchesEnvKeyList } from './recorder.js'
import { redact } from './redact.js'
import {
  aggregateEntries,
  buildGFlaggedRules,
  collectSuppressedHashes,
  ENV_KEY_MATCH_RULE,
  isSuppressedValue,
  matchHash,
  REDACTION_PLACEHOLDER_PATTERN,
  seedCountersFromCassette,
} from './redact-pipeline.js'
import { serialize } from './serialize.js'
import type {
  CassetteFile,
  Recording,
  RedactConfig,
  RedactionEntry,
  RedactSource,
  SuppressedEntry,
} from './types.js'
import { RECORDED_BY } from './version.js'

export type Finding = {
  /** Stable ID: `rec<recordingIndex>-<source>-<position>-<rule>` */
  id: string
  recordingIndex: number
  source: RedactSource
  rule: string
  /** Raw match (always populated; review --json without --include-match strips it before emit). */
  match: string
  /** `sha256:<64 hex>` — used for skip-set membership across runs. */
  matchHash: string
  matchLength: number
  /** First-4 + ellipsis + last-4 if length >= 12, else full match. */
  matchPreview: string
  /** Source-specific position label: `<line>:<col>` | `<argIndex>:<col>` | `<KEY>:<col>` */
  position: string
  /** Surrounding lines for human-readable display. lineNumber is 1-based. */
  context: {
    lineNumber: number
    before: string[]
    line: string
    after: string[]
  }
}

const CONTEXT_RADIUS = 2

/**
 * Walk every recording and produce review findings. Reuses the same
 * regex-based detection as scan, with two differences:
 *   1. Each finding includes context lines surrounding the match for
 *      terminal display.
 *   2. Matches whose hash appears in any recording's `suppressed` array
 *      are skipped — the user already chose to skip them.
 */
export function preScan(cassette: CassetteFile, config: Readonly<RedactConfig>): Finding[] {
  const skipSet = collectSuppressedHashes(cassette)
  const rules = buildGFlaggedRules(config)
  const findings: Finding[] = []
  for (let i = 0; i < cassette.recordings.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop bound guarantees index is valid
    findings.push(...scanRecording(cassette.recordings[i]!, i, rules, config, skipSet))
  }
  return findings
}

function scanRecording(
  rec: Recording,
  index: number,
  rules: readonly { name: string; pattern: RegExp }[],
  config: Readonly<RedactConfig>,
  skipSet: ReadonlySet<string>,
): Finding[] {
  // Compile-time exhaustiveness: each source is scanned explicitly below.
  // The type-level assertion fails compilation if a new RedactSource variant
  // is added without a corresponding scan block here.
  type _CoveredSources = 'env' | 'args' | 'stdin' | 'stdout' | 'stderr' | 'allLines'
  const _exhaustive: Exclude<RedactSource, _CoveredSources> extends never ? true : never = true
  void _exhaustive

  const findings: Finding[] = []

  for (const [key, value] of Object.entries(rec.call.env)) {
    // env-key-match: if the key matches the curated/user envKeys list, the
    // recorder would have redacted the whole value regardless of pattern.
    // Review must report this so cassettes that would have been redacted by
    // record mode aren't falsely shown as clean. Skip if the value is already
    // a redaction placeholder (don't double-report) or if its hash is
    // suppressed.
    if (matchesEnvKeyList(key, config.envKeys) && !REDACTION_PLACEHOLDER_PATTERN.test(value)) {
      const hash = matchHash(value)
      if (!skipSet.has(hash)) {
        const position = `${key}:0`
        findings.push({
          id: `rec${index}-env-${position}-${ENV_KEY_MATCH_RULE}`,
          recordingIndex: index,
          source: 'env',
          rule: ENV_KEY_MATCH_RULE,
          match: value,
          matchHash: hash,
          matchLength: value.length,
          matchPreview: previewMatch(value),
          position,
          context: { lineNumber: 1, before: [], line: value, after: [] },
        })
      }
      continue // don't also pattern-scan; whole value is already sensitive
    }
    findings.push(...scanValue(value, 'env', key, index, rules, config, skipSet, [], 1))
  }

  for (const [argIdx, arg] of rec.call.args.entries()) {
    findings.push(
      ...scanValue(arg, 'args', argIdx.toString(), index, rules, config, skipSet, [], 1),
    )
  }

  // stdin: single string source. Position label is '0' (no line/index dimension).
  if (rec.call.stdin !== null) {
    findings.push(...scanValue(rec.call.stdin, 'stdin', '0', index, rules, config, skipSet, [], 1))
  }

  for (let lineIdx = 0; lineIdx < rec.result.stdoutLines.length; lineIdx++) {
    findings.push(
      ...scanValue(
        // biome-ignore lint/style/noNonNullAssertion: loop bound guarantees index is valid
        rec.result.stdoutLines[lineIdx]!,
        'stdout',
        (lineIdx + 1).toString(),
        index,
        rules,
        config,
        skipSet,
        rec.result.stdoutLines,
        lineIdx + 1,
      ),
    )
  }

  for (let lineIdx = 0; lineIdx < rec.result.stderrLines.length; lineIdx++) {
    findings.push(
      ...scanValue(
        // biome-ignore lint/style/noNonNullAssertion: loop bound guarantees index is valid
        rec.result.stderrLines[lineIdx]!,
        'stderr',
        (lineIdx + 1).toString(),
        index,
        rules,
        config,
        skipSet,
        rec.result.stderrLines,
        lineIdx + 1,
      ),
    )
  }

  if (rec.result.allLines !== null) {
    for (let lineIdx = 0; lineIdx < rec.result.allLines.length; lineIdx++) {
      findings.push(
        ...scanValue(
          // biome-ignore lint/style/noNonNullAssertion: loop bound guarantees index is valid
          rec.result.allLines[lineIdx]!,
          'allLines',
          (lineIdx + 1).toString(),
          index,
          rules,
          config,
          skipSet,
          rec.result.allLines,
          lineIdx + 1,
        ),
      )
    }
  }

  return findings
}

function scanValue(
  value: string,
  source: RedactSource,
  positionLabel: string,
  recordingIndex: number,
  rules: readonly { name: string; pattern: RegExp }[],
  config: Readonly<RedactConfig>,
  skipSet: ReadonlySet<string>,
  contextLines: readonly string[],
  lineNumber: number,
): Finding[] {
  if (isSuppressedValue(value, config)) return []
  const findings: Finding[] = []
  for (const rule of rules) {
    rule.pattern.lastIndex = 0
    for (const m of value.matchAll(rule.pattern)) {
      const matchStr = m[0]
      const hash = matchHash(matchStr)
      if (skipSet.has(hash)) continue
      const col = m.index ?? 0
      const position = `${positionLabel}:${col}`
      findings.push({
        id: `rec${recordingIndex}-${source}-${position}-${rule.name}`,
        recordingIndex,
        source,
        rule: rule.name,
        match: matchStr,
        matchHash: hash,
        matchLength: matchStr.length,
        matchPreview: previewMatch(matchStr),
        position,
        context: buildContext(contextLines, lineNumber, value),
      })
    }
  }
  return findings
}

function buildContext(
  lines: readonly string[],
  lineNumber: number,
  fallbackLine: string,
): Finding['context'] {
  if (lines.length === 0) {
    return { lineNumber, before: [], line: fallbackLine, after: [] }
  }
  const idx = lineNumber - 1
  const before = lines.slice(Math.max(0, idx - CONTEXT_RADIUS), idx)
  const after = lines.slice(idx + 1, Math.min(lines.length, idx + 1 + CONTEXT_RADIUS))
  return {
    lineNumber,
    before: [...before],
    // biome-ignore lint/style/noNonNullAssertion: idx is in range by construction
    line: lines[idx]!,
    after: [...after],
  }
}

export type Decision =
  | { kind: 'accept' }
  | { kind: 'skip' }
  | { kind: 'replace'; with: string }
  | { kind: 'delete'; recordingIndex: number }

export type ReviewState = {
  readonly findings: readonly Finding[]
  readonly cursor: number
  /**
   * Stack of cursors saved before each forward advance. `back` pops from
   * here so multi-step jumps (e.g. `delete`'s contiguous-recording skip)
   * unwind to the actual prior decision point — not just `cursor - 1`.
   */
  readonly history: readonly number[]
  readonly decisions: ReadonlyMap<string, Decision>
  readonly step: 'reviewing' | 'confirming' | 'done' | 'aborted'
}

export type ReviewAction =
  | { kind: 'accept' }
  | { kind: 'skip' }
  | { kind: 'replace'; with: string }
  | { kind: 'delete' }
  | { kind: 'back' }
  | { kind: 'quit' }
  | { kind: 'apply' }
  | { kind: 'discard' }

/**
 * Pure state-machine transition. Returns a new ReviewState reflecting the
 * supplied action. No I/O. Tests drive this directly.
 *
 * Reviewing-step rules:
 *   - accept/skip: record decision, advance cursor by 1.
 *   - replace: record decision (with user-provided string), advance by 1.
 *   - delete: record decision targeted at the recording, then advance the
 *     cursor past every remaining finding in the same recording (those
 *     findings are moot because the recording is gone).
 *   - back: pop the prior cursor from history and rewind to it, removing
 *     every decision recorded in the unwound range so the user must
 *     re-decide. Empty history is a no-op (start of review or already
 *     fully unwound). Allowed from 'confirming' too — pops back to
 *     'reviewing' at the last decided finding.
 *   - quit: transition to 'aborted' (decisions discarded by caller).
 *
 * When the cursor advances past the last finding, the step transitions to
 * 'confirming'. From 'confirming':
 *   - apply: transition to 'done' with decisions intact (caller writes).
 *   - discard: transition to 'done' with decisions cleared.
 */
export function applyAction(state: ReviewState, action: ReviewAction): ReviewState {
  if (state.step !== 'reviewing' && state.step !== 'confirming') {
    return state // already done/aborted; no further transitions
  }

  switch (action.kind) {
    case 'quit':
      return { ...state, step: 'aborted' }
    case 'apply':
      return state.step === 'confirming' ? { ...state, step: 'done' } : state
    case 'discard':
      return state.step === 'confirming' ? { ...state, step: 'done', decisions: new Map() } : state
    case 'back':
      return applyBack(state)
    case 'accept':
    case 'skip':
    case 'replace':
    case 'delete':
      return state.step === 'reviewing' ? applyForward(state, action) : state
    default: {
      // Exhaustiveness guard: TypeScript narrows `action` to `never` here, so
      // adding a new ReviewAction variant without a case above fails at
      // compile time. The runtime throw is unreachable when the types are
      // correct.
      const _exhaustive: never = action
      throw new CassetteInternalError(`unhandled review action: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

function applyBack(state: ReviewState): ReviewState {
  if (state.history.length === 0) return state
  // biome-ignore lint/style/noNonNullAssertion: history.length > 0 guarantees last element
  const newCursor = state.history[state.history.length - 1]!
  const newHistory = state.history.slice(0, -1)
  // Remove every decision recorded in the unwound [newCursor, oldCursor) range.
  // For single-step advances this is just one decision; for `delete`'s
  // multi-step skip it's the lead decision plus any moot in-recording entries.
  const newDecisions = new Map(state.decisions)
  for (let i = newCursor; i < state.cursor; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i in [newCursor, cursor) ⊂ valid indices
    newDecisions.delete(state.findings[i]!.id)
  }
  return {
    ...state,
    cursor: newCursor,
    history: newHistory,
    decisions: newDecisions,
    step: 'reviewing',
  }
}

type ForwardAction = Extract<ReviewAction, { kind: 'accept' | 'skip' | 'replace' | 'delete' }>

function applyForward(state: ReviewState, action: ForwardAction): ReviewState {
  // biome-ignore lint/style/noNonNullAssertion: cursor in [0, findings.length) when reviewing
  const current = state.findings[state.cursor]!
  const newDecisions = new Map(state.decisions)
  let advanceTo = state.cursor + 1

  switch (action.kind) {
    case 'accept':
      newDecisions.set(current.id, { kind: 'accept' })
      break
    case 'skip':
      newDecisions.set(current.id, { kind: 'skip' })
      break
    case 'replace':
      newDecisions.set(current.id, { kind: 'replace', with: action.with })
      break
    case 'delete':
      newDecisions.set(current.id, { kind: 'delete', recordingIndex: current.recordingIndex })
      // Advance past every remaining finding in the same recording (moot once
      // deleted). Findings are contiguous-by-recording because preScan walks
      // cassette.recordings in order; a later caller producing an unsorted
      // findings array would break this skip.
      while (
        advanceTo < state.findings.length &&
        // biome-ignore lint/style/noNonNullAssertion: bounded by length check
        state.findings[advanceTo]!.recordingIndex === current.recordingIndex
      ) {
        advanceTo++
      }
      break
    default: {
      const _exhaustive: never = action
      throw new CassetteInternalError(
        `unhandled forward review action: ${JSON.stringify(_exhaustive)}`,
      )
    }
  }

  const newStep: ReviewState['step'] =
    advanceTo >= state.findings.length ? 'confirming' : 'reviewing'
  return {
    ...state,
    cursor: advanceTo,
    history: [...state.history, state.cursor],
    decisions: newDecisions,
    step: newStep,
  }
}

/**
 * Apply a batch of user decisions to a cassette and return the updated
 * CassetteFile. Pure function (no I/O); caller writes the result.
 *
 * Algorithm:
 *   1. Group decisions by recording index.
 *   2. Drop recordings flagged by any 'delete' decision.
 *   3. For each surviving recording:
 *      a. Apply 'replace' decisions inline (manual span substitution
 *         using the finding's stored match string + position).
 *      b. Build skipSet from 'skip' decisions in this recording.
 *      c. Re-run the redact pipeline on env/args/stdout/stderr/allLines
 *         with suppressedHashes: skipSet so 'accept' findings get
 *         counter-tagged placeholders while 'skip' findings stay as-is.
 *      d. Append SuppressedEntry per skip decision.
 *      e. Aggregate redaction entries (existing + new).
 *   4. Return new CassetteFile with the surviving recordings.
 *
 * Counters seeded from the existing cassette so newly-applied
 * placeholders continue the per-(source, rule) sequence.
 */
export function applyDecisions(
  cassette: CassetteFile,
  findings: readonly Finding[],
  decisions: ReadonlyMap<string, Decision>,
  config: Readonly<RedactConfig>,
): CassetteFile {
  const byRec = new Map<number, { finding: Finding; decision: Decision }[]>()
  for (const f of findings) {
    const d = decisions.get(f.id)
    if (d === undefined) continue
    const list = byRec.get(f.recordingIndex) ?? []
    list.push({ finding: f, decision: d })
    byRec.set(f.recordingIndex, list)
  }

  const toDelete = new Set<number>()
  for (const [idx, list] of byRec) {
    if (list.some(({ decision }) => decision.kind === 'delete')) toDelete.add(idx)
  }

  const counters = seedCountersFromCassette(cassette)
  const updatedRecordings: Recording[] = []

  for (let i = 0; i < cassette.recordings.length; i++) {
    if (toDelete.has(i)) continue
    // biome-ignore lint/style/noNonNullAssertion: i in [0, recordings.length)
    let rec = cassette.recordings[i]!
    const localDecisions = byRec.get(i) ?? []

    const newCustomEntries: RedactionEntry[] = []
    for (const { finding, decision } of localDecisions) {
      if (decision.kind !== 'replace') continue
      rec = applyReplace(rec, finding, decision.with)
      newCustomEntries.push({ rule: 'custom', source: finding.source, count: 1 })
    }

    const skipSet = new Set<string>()
    for (const { finding, decision } of localDecisions) {
      if (decision.kind === 'skip') skipSet.add(finding.matchHash)
    }

    const newRedactEntries: RedactionEntry[] = []
    const redactValue = (source: RedactSource, value: string, key?: string): string => {
      const r = redact({ source, value, key }, config, {
        counted: true,
        counters,
        suppressedHashes: skipSet,
      })
      newRedactEntries.push(...r.entries)
      return r.output
    }

    // Compile-time exhaustiveness: each source is dispatched explicitly
    // below. The type-level assertion here fails compilation if a new
    // RedactSource variant is added without a corresponding redactValue()
    // call in this block.
    type _CoveredSources = 'env' | 'args' | 'stdin' | 'stdout' | 'stderr' | 'allLines'
    const _exhaustive: Exclude<RedactSource, _CoveredSources> extends never ? true : never = true
    void _exhaustive

    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(rec.call.env)) {
      env[key] = redactValue('env', value, key)
    }
    const args = rec.call.args.map((arg) => redactValue('args', arg))
    const stdin = rec.call.stdin === null ? null : redactValue('stdin', rec.call.stdin)
    const stdoutLines = rec.result.stdoutLines.map((line) => redactValue('stdout', line))
    const stderrLines = rec.result.stderrLines.map((line) => redactValue('stderr', line))
    const allLines =
      rec.result.allLines === null
        ? null
        : rec.result.allLines.map((line) => redactValue('allLines', line))

    const newSuppressed: SuppressedEntry[] = [...rec.suppressed]
    for (const { finding, decision } of localDecisions) {
      if (decision.kind !== 'skip') continue
      newSuppressed.push({
        source: finding.source,
        rule: finding.rule,
        position: finding.position,
        matchHash: finding.matchHash,
      })
    }

    updatedRecordings.push({
      call: { ...rec.call, env, args, stdin },
      result: { ...rec.result, stdoutLines, stderrLines, allLines },
      redactions: aggregateEntries([...rec.redactions, ...newCustomEntries, ...newRedactEntries]),
      suppressed: newSuppressed,
    })
  }

  return {
    version: 2,
    recordedBy: cassette.recordedBy,
    recordings: updatedRecordings,
  }
}

/**
 * Replace the match span identified by `finding` with `replacement`.
 * Position is structured: env and stdin are whole-value, args/stdout/stderr/
 * allLines have line+col.
 *
 * Replace is documented as not available for args or stdin during the
 * interactive loop (canonicalize-incompatible), but applyReplace handles both
 * defensively in case the user's --json mode bypasses the dispatcher.
 *
 * Switch+`never` exhaustiveness: adding a new RedactSource variant without a
 * case here fails compilation at the `default` arm.
 */
function applyReplace(rec: Recording, finding: Finding, replacement: string): Recording {
  const { source } = finding
  // Local helper used by the line-shaped sources (stdout / stderr / allLines).
  // Hoisted to function scope so each case body is a flat single-source
  // expression, keeping the switch's variant-to-action mapping obvious.
  const replaceInLines = (lines: readonly string[]): string[] => {
    const lineNumber = Number.parseInt(finding.position.split(':')[0] ?? '1', 10)
    const col = Number.parseInt(finding.position.split(':')[1] ?? '0', 10)
    const lineIdx = lineNumber - 1
    const out = [...lines]
    // biome-ignore lint/style/noNonNullAssertion: lineIdx in range when reached
    const line = out[lineIdx]!
    out[lineIdx] = line.slice(0, col) + replacement + line.slice(col + finding.matchLength)
    return out
  }
  switch (source) {
    case 'env': {
      const key = finding.position.split(':')[0] ?? ''
      const env = { ...rec.call.env, [key]: replacement }
      return { ...rec, call: { ...rec.call, env } }
    }
    case 'args': {
      const argIdx = Number.parseInt(finding.position.split(':')[0] ?? '0', 10)
      const col = Number.parseInt(finding.position.split(':')[1] ?? '0', 10)
      const args = [...rec.call.args]
      // biome-ignore lint/style/noNonNullAssertion: argIdx in range when reached
      const arg = args[argIdx]!
      args[argIdx] = arg.slice(0, col) + replacement + arg.slice(col + finding.matchLength)
      return { ...rec, call: { ...rec.call, args } }
    }
    case 'stdin':
      // Whole-value replacement; stdin is a single string. Defensive parallel
      // to env's branch. Should not be reached in normal flow because
      // readNextAction gates 'r' for stdin findings.
      return { ...rec, call: { ...rec.call, stdin: replacement } }
    case 'stdout':
      return {
        ...rec,
        result: { ...rec.result, stdoutLines: replaceInLines(rec.result.stdoutLines) },
      }
    case 'stderr':
      return {
        ...rec,
        result: { ...rec.result, stderrLines: replaceInLines(rec.result.stderrLines) },
      }
    case 'allLines':
      if (rec.result.allLines === null) return rec
      return { ...rec, result: { ...rec.result, allLines: replaceInLines(rec.result.allLines) } }
    default: {
      const _exhaustive: never = source
      throw new CassetteInternalError(`unhandled redact source: ${String(_exhaustive)}`)
    }
  }
}

const REVIEW_VERSION = 1

const REVIEW_HELP = `\
Usage:
  shell-cassette review <path> [options]

Walks unredacted findings interactively. For each finding the user picks:
  (a) accept     apply default redaction (counter-tagged placeholder)
  (s) skip       leave match in body, persist via _suppressed
  (r) replace    substitute user-provided string (NOT for args or stdin)
  (d) delete     remove the entire recording
  (b) back       revisit previous finding
  (q) quit       discard all decisions
  (?) help       print key reference

Decisions are batched and applied on confirm. Quit discards everything.

Exit codes:
  0   reviewed (with or without changes)
  2   error (missing path, malformed cassette, conflicting flags)

Options:
  --json              read-only structured output (no prompts)
  --include-match     [with --json] include raw match values (UNSAFE for piping)
  --config <path>     override config discovery
  --no-color
  --color=always
  --help
`

type ColorOverride = 'auto' | 'always' | 'never'

type ReviewFlags = {
  path: string | null
  json: boolean
  includeMatch: boolean
  configPath?: string
  colorOverride: ColorOverride
  help: boolean
}

function parseReviewArgs(args: readonly string[]): ReviewFlags {
  const flags: ReviewFlags = {
    path: null,
    json: false,
    includeMatch: false,
    colorOverride: 'auto',
    help: false,
  }
  for (let i = 0; i < args.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop bound
    const arg = args[i]!
    if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--include-match') flags.includeMatch = true
    else if (arg === '--no-color') flags.colorOverride = 'never'
    else if (arg === '--color=always') flags.colorOverride = 'always'
    else if (arg === '--config') {
      const next = args[++i]
      if (next === undefined) throw new CassetteConfigError('--config requires a path argument')
      flags.configPath = next
    } else if (arg.startsWith('--config=')) {
      flags.configPath = arg.slice('--config='.length)
    } else if (arg.startsWith('--')) {
      throw new CassetteConfigError(`unknown flag: ${arg}`)
    } else {
      if (flags.path !== null) throw new CassetteConfigError('review takes exactly one path')
      flags.path = arg
    }
  }
  return flags
}

export async function runReview(args: readonly string[]): Promise<number> {
  let flags: ReviewFlags
  try {
    flags = parseReviewArgs(args)
  } catch (e) {
    stderr(`error: ${(e as Error).message}\n${REVIEW_HELP}`)
    return 2
  }

  if (flags.help) {
    stdout(REVIEW_HELP)
    return 0
  }
  if (flags.path === null) {
    stderr(`error: review requires a path\n${REVIEW_HELP}`)
    return 2
  }

  setupCliColor(flags.colorOverride)

  let cassette: CassetteFile
  try {
    const loaded = await loadCassette(flags.path)
    if (loaded === null) throw new CassetteNotFoundError(flags.path)
    cassette = loaded
  } catch (e) {
    stderr(`error: ${(e as Error).message}`)
    return 2
  }

  const config = flags.configPath
    ? await loadConfigFromFile(flags.configPath)
    : await loadConfigFromDir(process.cwd())

  const findings = preScan(cassette, config.redact)

  if (flags.json) {
    return runJsonMode(findings, flags.includeMatch)
  }

  if (findings.length === 0) {
    stdout('No new findings under current rules. Cassette is clean.')
    return 0
  }

  let state: ReviewState = {
    findings,
    cursor: 0,
    history: [],
    decisions: new Map(),
    step: 'reviewing',
  }
  while (state.step === 'reviewing') {
    // biome-ignore lint/style/noNonNullAssertion: cursor in range when reviewing
    renderFinding(state.findings[state.cursor]!, state.cursor, state.findings.length)
    const action = await readNextAction(state)
    state = applyAction(state, action)
  }

  if (state.step === 'confirming') {
    renderSummary(state)
    const apply = await promptYesNo(`Apply changes to ${flags.path}?`)
    state = applyAction(state, apply ? { kind: 'apply' } : { kind: 'discard' })
  }

  if (state.step === 'aborted' || state.decisions.size === 0) {
    stdout('No changes written.')
    return 0
  }

  const updated = applyDecisions(cassette, state.findings, state.decisions, config.redact)
  // Stamp recordedBy with current shell-cassette identity on write.
  const stamped: CassetteFile = { ...updated, recordedBy: RECORDED_BY }
  await writeCassetteFile(flags.path, serialize(stamped))
  const counts = countDecisions(state)
  stdout(
    `Wrote 1 cassette. ${counts.accept} accept, ${counts.skip} skip, ${counts.replace} replace, ${counts.delete} deleted.`,
  )
  return 0
}

function runJsonMode(findings: readonly Finding[], includeMatch: boolean): number {
  const byRule: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  for (const f of findings) {
    byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
    bySource[f.source] = (bySource[f.source] ?? 0) + 1
  }
  const out = {
    reviewVersion: REVIEW_VERSION,
    summary: { totalFindings: findings.length, byRule, bySource },
    findings: findings.map((f) => ({
      id: f.id,
      recordingIndex: f.recordingIndex,
      source: f.source,
      rule: f.rule,
      ...(includeMatch ? { match: f.match } : {}),
      matchHash: f.matchHash,
      matchLength: f.matchLength,
      matchPreview: f.matchPreview,
      position: f.position,
      context: f.context,
    })),
  }
  stdout(JSON.stringify(out, null, 2))
  return 0
}

function renderFinding(finding: Finding, cursor: number, total: number): void {
  stdout('')
  stdout(`${color.bold(`[Finding ${cursor + 1}/${total}]`)} ${finding.rule} in ${finding.source}`)
  stdout(`Recording ${finding.recordingIndex + 1}: ${finding.id}`)
  stdout(
    `Match: ${color.cyan(finding.matchPreview)} (${finding.matchLength} chars, ${finding.matchHash})`,
  )
  stdout('')
  stdout('Context:')
  for (const before of finding.context.before) {
    stdout(`  ${applyTruncation(before, 80)}`)
  }
  stdout(`  ${color.red(applyTruncation(finding.context.line, 80))}`)
  for (const after of finding.context.after) {
    stdout(`  ${applyTruncation(after, 80)}`)
  }
  stdout('')
}

function renderSummary(state: ReviewState): void {
  const c = countDecisions(state)
  stdout('')
  stdout(color.bold('Summary:'))
  stdout(
    `  ${c.accept} accept, ${c.skip} skip, ${c.replace} replace, ${c.delete} deleted recording(s)`,
  )
}

function countDecisions(state: ReviewState): {
  accept: number
  skip: number
  replace: number
  delete: number
} {
  const out = { accept: 0, skip: 0, replace: 0, delete: 0 }
  // Multiple findings inside one deleted recording collapse into a single
  // user-visible "deleted recording" in the summary count.
  const seenDeletedRecs = new Set<number>()
  for (const d of state.decisions.values()) {
    if (d.kind === 'accept') out.accept++
    else if (d.kind === 'skip') out.skip++
    else if (d.kind === 'replace') out.replace++
    else if (d.kind === 'delete') {
      if (!seenDeletedRecs.has(d.recordingIndex)) {
        seenDeletedRecs.add(d.recordingIndex)
        out.delete++
      }
    }
  }
  return out
}

async function readNextAction(state: ReviewState): Promise<ReviewAction> {
  // biome-ignore lint/style/noNonNullAssertion: cursor in range when reviewing
  const finding = state.findings[state.cursor]!
  // (r)eplace is unavailable for sources participating in canonicalize-then-match
  // (args and stdin: both feed into the matcher tuple).
  const allowed =
    finding.source === 'args' || finding.source === 'stdin'
      ? ['a', 's', 'd', 'b', 'q', '?']
      : ['a', 's', 'r', 'd', 'b', 'q', '?']
  while (true) {
    const key = await promptAction(allowed)
    if (key === '?') {
      printActionHelp()
      continue
    }
    if (key === 'a') return { kind: 'accept' }
    if (key === 's') return { kind: 'skip' }
    if (key === 'b') return { kind: 'back' }
    if (key === 'q') return { kind: 'quit' }
    if (key === 'r') {
      const replacement = await promptText('Replacement value:')
      return { kind: 'replace', with: replacement }
    }
    if (key === 'd') {
      const ok = await promptYesNo(`Delete entire recording ${finding.recordingIndex + 1}?`)
      if (ok) return { kind: 'delete' }
      // user declined; loop will re-prompt for a different action
    }
  }
}

function printActionHelp(): void {
  stdout(`
  (a) accept     apply default redaction
  (s) skip       leave verbatim, persist via _suppressed
  (r) replace    substitute custom string (NOT for args)
  (d) delete     remove entire recording
  (b) back       revisit previous finding
  (q) quit       discard all decisions
  (?) help       this listing
`)
}
