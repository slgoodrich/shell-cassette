/**
 * Interactive prompt helpers used by `shell-cassette review`. Wraps Node's
 * built-in `node:readline/promises` (stdlib; no npm dependency).
 *
 * The reader is a settable module-level singleton so unit tests can inject
 * a fake without spawning a subprocess. Production code calls `getReader()`
 * which lazily constructs a real readline interface bound to process.stdin
 * and process.stdout.
 *
 * Prompt strings are explicitly NOT API. Bots should use `--json` modes for
 * automation; do not parse interactive prompt text. Action keys (which are
 * read from user input) ARE API and locked.
 */
import * as readline from 'node:readline/promises'
import { stderr } from './cli-output.js'

export type Reader = {
  question(prompt: string): Promise<string>
  close(): void
}

let _reader: Reader | null = null

function getReader(): Reader {
  if (_reader !== null) return _reader
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  _reader = {
    question: (q) => rl.question(q),
    close: () => rl.close(),
  }
  return _reader
}

/**
 * Override the prompt reader. Tests inject a fake `Reader` to avoid
 * subprocess spawning. Pass `null` to reset (closing the previous reader
 * if it owned a real readline interface).
 */
export function setReader(reader: Reader | null): void {
  if (_reader !== null && reader === null) {
    _reader.close()
  }
  _reader = reader
}

/**
 * Prompt for an action key from the `allowed` list (e.g. `['a', 's', 'q', '?']`).
 * Case-insensitive; leading/trailing whitespace ignored. Re-prompts on
 * unknown input. Returns the lowercased key.
 */
export async function promptAction(allowed: readonly string[]): Promise<string> {
  const allowedSet = new Set(allowed.map((s) => s.toLowerCase()))
  const prompt = `Action? (${allowed.join('/')})\n> `
  const reader = getReader()
  while (true) {
    const line = await reader.question(prompt)
    const trimmed = line.trim().toLowerCase()
    if (allowedSet.has(trimmed)) return trimmed
    stderr(`(unknown action: '${trimmed}'; expected one of ${allowed.join(', ')})`)
  }
}

/** Prompt for free-text input. Returns the trimmed string. */
export async function promptText(label: string): Promise<string> {
  const reader = getReader()
  const line = await reader.question(`${label}\n> `)
  return line.trim()
}

/**
 * Prompt for yes/no. Default is no (empty input returns false). Accepts
 * `y`/`yes`/`n`/`no` case-insensitively; re-prompts on anything else.
 */
export async function promptYesNo(label: string): Promise<boolean> {
  const reader = getReader()
  while (true) {
    const ans = (await reader.question(`${label} (y/N)\n> `)).trim().toLowerCase()
    if (ans === '' || ans === 'n' || ans === 'no') return false
    if (ans === 'y' || ans === 'yes') return true
    stderr('(expected y or n)')
  }
}
