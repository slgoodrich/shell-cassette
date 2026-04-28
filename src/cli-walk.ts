import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Resolve cassette paths from user-provided input.
 *
 * For each input:
 *   - If a file, included as-is. Caller is responsible for ensuring it's a
 *     valid cassette; explicit paths are trusted.
 *   - If a directory, walk recursively for `*.json` files. Each candidate is
 *     parsed; only those with a numeric `version` field of 1 or 2 are
 *     included. Filtering protects against picking up package.json or other
 *     non-cassette JSON in cassette directories.
 *
 * Throws if any input path does not exist. Silently skips non-cassette JSON
 * within directories. Returns deduplicated list of absolute paths.
 */
export async function walkCassettes(inputs: readonly string[]): Promise<string[]> {
  const out = new Set<string>()
  for (const input of inputs) {
    const abs = path.resolve(input)
    let st: Awaited<ReturnType<typeof stat>>
    try {
      st = await stat(abs)
    } catch {
      throw new Error(`path not found: ${input}`)
    }
    if (st.isFile()) {
      out.add(abs)
    } else if (st.isDirectory()) {
      for (const found of await walkDir(abs)) {
        out.add(found)
      }
    }
  }
  return [...out]
}

async function walkDir(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkDir(full)))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      if (await isCassette(full)) {
        out.push(full)
      }
    }
  }
  return out
}

async function isCassette(filePath: string): Promise<boolean> {
  try {
    const text = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(text) as unknown
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      ((parsed as Record<string, unknown>).version === 1 ||
        (parsed as Record<string, unknown>).version === 2)
    )
  } catch {
    return false
  }
}
