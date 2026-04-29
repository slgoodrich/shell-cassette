import { Readable } from 'node:stream'

/**
 * Build a Readable stream that emits each line with a delay between pushes.
 * Required because Node's `readline.question` can drop a queued answer if
 * stdin EOFs before the next `question()` call is registered. The delay
 * gives the CLI time to render its prompt and re-register before the next
 * answer lands.
 *
 * Pacing is 250ms — 100ms was sufficient on Linux but flaky on Windows CI
 * where readline event scheduling is slower. The added latency only affects
 * e2e tests (5 tests × 250ms × ~3 prompts each ≈ 4 seconds total), well
 * within the e2e budget.
 *
 * Used by e2e tests that drive interactive subcommands (review today; the
 * helper is generic enough that any future interactive CLI e2e can reuse).
 */
const PACE_MS = 250

export function pacedStdin(lines: readonly string[]): Readable {
  let i = 0
  return new Readable({
    read() {
      if (i >= lines.length) {
        // Delay EOF too so the final answer has time to land before stdin closes.
        setTimeout(() => this.push(null), PACE_MS)
        return
      }
      const line = lines[i]
      i++
      setTimeout(() => this.push(`${line}\n`), PACE_MS)
    },
  })
}
