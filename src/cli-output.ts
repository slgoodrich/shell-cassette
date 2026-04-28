/**
 * CLI output helpers for the shell-cassette binary. Hand-rolled ANSI color
 * codes (no external dependency).
 *
 * Color decision (in priority order):
 *   1. --color=always flag -> forced enable
 *   2. --no-color flag -> forced disable
 *   3. NO_COLOR env var (https://no-color.org) -> disabled when set to non-empty
 *   4. TTY auto-detect -> enabled if stdout is a TTY
 */

let enabled = false

export type ColorOverride = 'auto' | 'always' | 'never' | undefined

export const color = {
  setEnabled(v: boolean): void {
    enabled = v
  },
  isEnabled(): boolean {
    return enabled
  },
  cyan: (s: string) => (enabled ? `\x1b[36m${s}\x1b[0m` : s),
  red: (s: string) => (enabled ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (enabled ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (enabled ? `\x1b[33m${s}\x1b[0m` : s),
  bold: (s: string) => (enabled ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (enabled ? `\x1b[2m${s}\x1b[0m` : s),
}

export const isTty = {
  shouldUseColor(opts: { tty: boolean; override: ColorOverride }): boolean {
    if (opts.override === 'always') return true
    if (opts.override === 'never') return false
    if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false
    return opts.tty
  },
  detectStdoutTty(): boolean {
    return Boolean(process.stdout.isTTY)
  },
}

export function applyTruncation(s: string, limit: number): string {
  if (s.length === 0) return s
  if (s.length <= limit) return s
  return `${s.slice(0, limit)}…`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function stdout(s: string, opts?: { newline?: boolean }): void {
  const ending = opts?.newline === false ? '' : '\n'
  process.stdout.write(s + ending)
}

export function stderr(s: string, opts?: { newline?: boolean }): void {
  const ending = opts?.newline === false ? '' : '\n'
  process.stderr.write(s + ending)
}
