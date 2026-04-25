import { createHash } from 'node:crypto'
import path from 'node:path'
import { CassetteIOError } from './errors.js'

const MAX_NAME_LENGTH = 80
const HASH_SUFFIX_LENGTH = 6
const MAX_PATH_LENGTH = 240

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, HASH_SUFFIX_LENGTH)
}

export function sanitizeName(input: string): string {
  if (!input) return 'untitled'

  // NFKD normalize, drop combining marks (accents)
  const normalized = input.normalize('NFKD').replace(/\p{M}/gu, '')
  // Strip non-ASCII
  const ascii = normalized.replace(/[^\x20-\x7E]/g, '')
  // Lowercase, replace non-alphanumeric with dashes, collapse
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!slug) return 'untitled'

  if (slug.length > MAX_NAME_LENGTH) {
    const truncated = slug.slice(0, MAX_NAME_LENGTH)
    return `${truncated}-${shortHash(input)}`
  }

  return slug
}

export function cassettePath(
  testFile: string,
  describePath: readonly string[],
  testName: string,
  cassetteDir: string,
): string {
  const dir = path.posix.dirname(testFile)
  const fileBasename = path.posix.basename(testFile)
  const sanitizedDescribe = describePath.map(sanitizeName)
  const sanitizedTest = sanitizeName(testName)

  const fullPath = path.posix.join(
    dir,
    cassetteDir,
    fileBasename,
    ...sanitizedDescribe,
    `${sanitizedTest}.json`,
  )

  if (fullPath.length > MAX_PATH_LENGTH) {
    throw new CassetteIOError(
      `cassette path exceeds ${MAX_PATH_LENGTH} chars (Windows MAX_PATH safety): ${fullPath}`,
      new Error('PathTooLong'),
    )
  }

  return fullPath
}
