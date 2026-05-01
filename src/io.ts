// Named import: @types/node ^22 omits isUtf8 from BufferConstructor, so Buffer.isUtf8(buf) fails to type-check.
import { isUtf8 } from 'node:buffer'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BinaryInputError, CassetteIOError } from './errors.js'

/**
 * Wraps a native fs error in CassetteIOError preserving cause. The action is
 * a complete phrase including the verb, noun, and preposition (e.g.
 * 'write cassette to' or 'read inputFile from'); it slots in directly between
 * 'failed to' and the target path.
 */
function wrapFsError(action: string, target: string | URL, err: NodeJS.ErrnoException): never {
  throw new CassetteIOError(`failed to ${action} ${String(target)}: ${err.message}`, err)
}

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
    wrapFsError('write cassette to', target, e as NodeJS.ErrnoException)
  }
}

export async function readCassetteFile(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    wrapFsError('read cassette from', target, err)
  }
}

/**
 * Reads a file intended to feed subprocess stdin (execa's `inputFile` option).
 * Bytes are returned verbatim as a UTF-8 string; non-UTF-8 content rejects.
 *
 * No BOM stripping, no line-ending normalization. Real execa receives the
 * same content via its own pipe of the file; this read is the capture path
 * so the bytes can flow through canonicalization and the redact pipeline
 * alongside args/stdout/stderr.
 */
export async function readInputFile(target: string | URL): Promise<string> {
  let buf: Buffer
  try {
    buf = await readFile(target)
  } catch (e) {
    wrapFsError('read inputFile from', target, e as NodeJS.ErrnoException)
  }
  if (!isUtf8(buf)) {
    throw new BinaryInputError(
      `inputFile contains non-UTF-8 bytes: ${String(target)}\n` +
        `shell-cassette stores stdin as UTF-8. For binary stdin, run with ` +
        `SHELL_CASSETTE_MODE=passthrough to bypass cassette mode for this test.`,
    )
  }
  return buf.toString('utf8')
}
