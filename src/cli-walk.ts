import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { CassetteIOError } from './errors.js'
import { readCassetteFile } from './io.js'
import { deserialize } from './serialize.js'

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
  const results = await Promise.all(
    inputs.map(async (input) => {
      const abs = path.resolve(input)
      let st: Awaited<ReturnType<typeof stat>>
      try {
        st = await stat(abs)
      } catch (e) {
        throw new CassetteIOError(`cassette path not found: ${input}`, e as Error)
      }
      if (st.isFile()) return [abs]
      if (st.isDirectory()) return walkDir(abs)
      return [] as string[]
    }),
  )
  for (const paths of results) {
    for (const p of paths) {
      out.add(p)
    }
  }
  return [...out]
}

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const results = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        return walkDir(full)
      }
      if (entry.isFile() && entry.name.endsWith('.json') && (await isCassette(full))) {
        return [full]
      }
      return [] as string[]
    }),
  )
  return results.flat()
}

async function isCassette(filePath: string): Promise<boolean> {
  try {
    const text = await readCassetteFile(filePath)
    if (text === null) return false
    deserialize(text) // throws CassetteCorruptError on bad JSON, missing version, unknown version
    return true
  } catch {
    return false
  }
}
