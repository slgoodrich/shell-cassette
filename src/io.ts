import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CassetteIOError } from './errors.js'

export async function writeCassetteFile(target: string, content: string): Promise<void> {
  const dir = path.dirname(target)
  await mkdir(dir, { recursive: true })

  const tempPath = `${target}.tmp.${process.pid}.${Date.now()}`
  try {
    await writeFile(tempPath, content, 'utf8')
    await rename(tempPath, target)
  } catch (e) {
    // Best-effort cleanup of temp file
    try {
      await unlink(tempPath)
    } catch {
      // ignore
    }
    throw new CassetteIOError(
      `failed to write cassette to ${target}: ${(e as Error).message}`,
      e as Error,
    )
  }
}

export async function readCassetteFile(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw new CassetteIOError(`failed to read cassette from ${target}: ${err.message}`, err)
  }
}
