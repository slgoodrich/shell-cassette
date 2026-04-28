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
import { BUNDLED_PATTERNS } from './redact-patterns.js'
import {
  collectSuppressedHashes,
  ENV_KEY_MATCH_RULE,
  matchHash,
  REDACTION_PLACEHOLDER_PATTERN,
} from './redact-pipeline.js'
import type { CassetteFile, Recording, RedactConfig, RedactSource } from './types.js'

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
