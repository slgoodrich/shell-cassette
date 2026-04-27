import path from 'node:path'

// Order matters: more-specific prefixes (/var/tmp, /private/tmp, /var/folders) must
// run before the plain /tmp pattern, otherwise /var/tmp is partially consumed by /tmp
// first, leaving a `/var` prefix.
//
// These are module-level g-flag RegExp instances. Use them ONLY with
// `String.prototype.replace`, never `.test()` or `.exec()` — the g flag makes those
// methods stateful via `lastIndex`, which would carry state across calls.
const TMP_PREFIX_PATTERNS: readonly RegExp[] = [
  /\/var\/folders\/[^/]+\/[^/]+\/T\/[^/\s]+/g,
  /\/var\/tmp\/[^/\s]+/g,
  /\/private\/tmp\/[^/\s]+/g,
  /\/tmp\/[^/\s]+/g,
  /[A-Z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\[^\\\s]+/g,
]

export const TMP_TOKEN = '<tmp>'

export function normalizeTmpPath(s: string): string {
  let out = s
  for (const re of TMP_PREFIX_PATTERNS) {
    out = out.replace(re, TMP_TOKEN)
  }
  return out
}

export function basenameCommand(cmd: string): string {
  const base = path.basename(cmd)
  if (process.platform === 'win32' && base.toLowerCase().endsWith('.exe')) {
    return base.slice(0, -4)
  }
  return base
}
