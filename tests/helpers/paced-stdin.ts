import { Readable } from 'node:stream'

/**
 * Build a Readable stream that emits each line with a small delay between
 * pushes. Required because Node's `readline.question` can drop a queued
 * answer if stdin EOFs before the next `question()` call is registered.
 * A 100ms gap gives a CLI time to render its prompt and re-register before
 * the next answer lands.
 *
 * Used by e2e tests that drive interactive subcommands (review today; the
 * helper is generic enough that any future interactive CLI e2e can reuse).
 */
export function pacedStdin(lines: readonly string[]): Readable {
  let i = 0
  return new Readable({
    read() {
      if (i >= lines.length) {
        // Delay EOF too so the final answer has time to land before stdin closes.
        setTimeout(() => this.push(null), 100)
        return
      }
      const line = lines[i]
      i++
      setTimeout(() => this.push(`${line}\n`), 100)
    },
  })
}
