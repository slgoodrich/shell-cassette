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
 * Action keys (a/s/r/d/b/q/?) are API-locked. Renames would be a breaking
 * change. Prompt strings are NOT API.
 */
import { previewMatch } from './cli-output.js'
import { matchesEnvKeyList } from './recorder.js'
import { redact } from './redact.js'
import { BUNDLED_PATTERNS } from './redact-patterns.js'
import {
  aggregateEntries,
  collectSuppressedHashes,
  ENV_KEY_MATCH_RULE,
  matchHash,
  REDACTION_PLACEHOLDER_PATTERN,
  seedCountersFromCassette,
} from './redact-pipeline.js'
import type {
  CassetteFile,
  Recording,
  RedactConfig,
  RedactionEntry,
  RedactSource,
  SuppressedEntry,
} from './types.js'

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

function buildGFlaggedRules(
  config: Readonly<RedactConfig>,
): readonly { name: string; pattern: RegExp }[] {
  const rules: { name: string; pattern: RegExp }[] = []
  if (config.bundledPatterns) {
    for (const rule of BUNDLED_PATTERNS) {
      if (rule.pattern instanceof RegExp) {
        const flags = rule.pattern.flags.includes('g')
          ? rule.pattern.flags
          : `${rule.pattern.flags}g`
        rules.push({ name: rule.name, pattern: new RegExp(rule.pattern.source, flags) })
      }
    }
  }
  for (const rule of config.customPatterns) {
    if (rule.pattern instanceof RegExp) {
      const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`
      rules.push({ name: rule.name, pattern: new RegExp(rule.pattern.source, flags) })
    }
    // Function-typed custom patterns can't expose individual match spans for
    // position-precise findings; same gap as cli-scan.
  }
  return rules
}

function isSuppressedValue(value: string, config: Readonly<RedactConfig>): boolean {
  for (const sup of config.suppressPatterns) {
    sup.lastIndex = 0
    if (sup.test(value)) return true
  }
  return false
}

function scanRecording(
  rec: Recording,
  index: number,
  rules: readonly { name: string; pattern: RegExp }[],
  config: Readonly<RedactConfig>,
  skipSet: ReadonlySet<string>,
): Finding[] {
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

  if (action.kind === 'quit') {
    return { ...state, step: 'aborted' }
  }
  if (action.kind === 'apply') {
    if (state.step !== 'confirming') return state
    return { ...state, step: 'done' }
  }
  if (action.kind === 'discard') {
    if (state.step !== 'confirming') return state
    return { ...state, step: 'done', decisions: new Map() }
  }

  if (action.kind === 'back') {
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

  // From here on, forward actions are only valid in 'reviewing' step
  if (state.step !== 'reviewing') return state

  // biome-ignore lint/style/noNonNullAssertion: cursor in [0, findings.length) when reviewing
  const current = state.findings[state.cursor]!
  const newDecisions = new Map(state.decisions)
  let advanceTo = state.cursor + 1

  if (action.kind === 'accept') {
    newDecisions.set(current.id, { kind: 'accept' })
  } else if (action.kind === 'skip') {
    newDecisions.set(current.id, { kind: 'skip' })
  } else if (action.kind === 'replace') {
    newDecisions.set(current.id, { kind: 'replace', with: action.with })
  } else if (action.kind === 'delete') {
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
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(rec.call.env)) {
      const r = redact({ source: 'env', value }, config, {
        counted: true,
        counters,
        suppressedHashes: skipSet,
      })
      env[key] = r.output
      newRedactEntries.push(...r.entries)
    }
    const args = rec.call.args.map((arg) => {
      const r = redact({ source: 'args', value: arg }, config, {
        counted: true,
        counters,
        suppressedHashes: skipSet,
      })
      newRedactEntries.push(...r.entries)
      return r.output
    })
    const stdoutLines = rec.result.stdoutLines.map((line) => {
      const r = redact({ source: 'stdout', value: line }, config, {
        counted: true,
        counters,
        suppressedHashes: skipSet,
      })
      newRedactEntries.push(...r.entries)
      return r.output
    })
    const stderrLines = rec.result.stderrLines.map((line) => {
      const r = redact({ source: 'stderr', value: line }, config, {
        counted: true,
        counters,
        suppressedHashes: skipSet,
      })
      newRedactEntries.push(...r.entries)
      return r.output
    })
    const allLines =
      rec.result.allLines === null
        ? null
        : rec.result.allLines.map((line) => {
            const r = redact({ source: 'allLines', value: line }, config, {
              counted: true,
              counters,
              suppressedHashes: skipSet,
            })
            newRedactEntries.push(...r.entries)
            return r.output
          })

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
      call: { ...rec.call, env, args },
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
 * Position is structured: env values are whole-value, args/stdout/stderr/
 * allLines have line+col.
 *
 * Replace is documented as not available for args during the interactive
 * loop (canonicalize-incompatible), but applyReplace handles args
 * defensively in case the user's --json mode bypasses the dispatcher.
 */
function applyReplace(rec: Recording, finding: Finding, replacement: string): Recording {
  const { source } = finding
  if (source === 'env') {
    const key = finding.position.split(':')[0] ?? ''
    const env = { ...rec.call.env, [key]: replacement }
    return { ...rec, call: { ...rec.call, env } }
  }
  if (source === 'args') {
    const argIdx = Number.parseInt(finding.position.split(':')[0] ?? '0', 10)
    const col = Number.parseInt(finding.position.split(':')[1] ?? '0', 10)
    const args = [...rec.call.args]
    // biome-ignore lint/style/noNonNullAssertion: argIdx in range when reached
    const arg = args[argIdx]!
    args[argIdx] = arg.slice(0, col) + replacement + arg.slice(col + finding.matchLength)
    return { ...rec, call: { ...rec.call, args } }
  }
  const lineNumber = Number.parseInt(finding.position.split(':')[0] ?? '1', 10)
  const col = Number.parseInt(finding.position.split(':')[1] ?? '0', 10)
  const lineIdx = lineNumber - 1
  const replaceInLines = (lines: string[]): string[] => {
    const out = [...lines]
    // biome-ignore lint/style/noNonNullAssertion: lineIdx in range when reached
    const line = out[lineIdx]!
    out[lineIdx] = line.slice(0, col) + replacement + line.slice(col + finding.matchLength)
    return out
  }
  if (source === 'stdout') {
    return {
      ...rec,
      result: { ...rec.result, stdoutLines: replaceInLines(rec.result.stdoutLines) },
    }
  }
  if (source === 'stderr') {
    return {
      ...rec,
      result: { ...rec.result, stderrLines: replaceInLines(rec.result.stderrLines) },
    }
  }
  if (rec.result.allLines === null) return rec
  return { ...rec, result: { ...rec.result, allLines: replaceInLines(rec.result.allLines) } }
}
