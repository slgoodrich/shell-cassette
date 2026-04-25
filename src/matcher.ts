import { log } from './log.js'
import type { Call, MatcherFn, MatcherStateLike, Recording } from './types.js'

export const defaultMatcher: MatcherFn = (call, rec) =>
  call.command === rec.call.command && deepEqualArgs(call.args, rec.call.args)

function deepEqualArgs(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export class MatcherState implements MatcherStateLike {
  private consumedIndices: Set<number> = new Set()

  constructor(
    private readonly recordings: readonly Recording[],
    private readonly matcher: MatcherFn,
  ) {}

  findMatch(call: Call): Recording | null {
    const candidates: { index: number; rec: Recording }[] = []
    let i = 0
    for (const rec of this.recordings) {
      if (!this.consumedIndices.has(i) && this.matcher(call, rec)) {
        candidates.push({ index: i, rec })
      }
      i++
    }

    const first = candidates[0]
    if (first === undefined) return null

    if (candidates.length > 1) {
      log(
        `ambiguous match: ${candidates.length} unconsumed recordings could match \`${call.command} ${call.args.join(' ')}\` — taking first`,
      )
    }

    this.consumedIndices.add(first.index)
    return first.rec
  }
}
