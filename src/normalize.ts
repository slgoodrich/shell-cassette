// Per-OS regex table for absolute mkdtemp prefixes.
// Each pattern matches a tmp prefix followed by exactly one path component.
// `g` flag so substring-anywhere replacement works (e.g., `--config=/tmp/abc/x.json`).
// Order matters: more-specific prefixes (/var/tmp, /private/tmp, /var/folders) must
// run before the plain /tmp pattern so /var/tmp and /private/tmp are not partially
// consumed by /tmp first, leaving a `/var` or `/private` prefix.
const TMP_PREFIX_PATTERNS: readonly RegExp[] = [
  /\/var\/folders\/[^/]+\/[^/]+\/T\/[^/\s]+/g,
  /\/var\/tmp\/[^/\s]+/g,
  /\/private\/tmp\/[^/\s]+/g,
  /\/tmp\/[^/\s]+/g,
  /[A-Z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\[^\\\s]+/g,
]

const TMP_TOKEN = '<tmp>'

export function normalizeTmpPath(s: string): string {
  let out = s
  for (const re of TMP_PREFIX_PATTERNS) {
    out = out.replace(re, TMP_TOKEN)
  }
  return out
}
