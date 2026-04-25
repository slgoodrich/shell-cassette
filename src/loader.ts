import { readCassetteFile } from './io.js'
import { deserialize } from './serialize.js'
import type { CassetteFile } from './types.js'

export async function loadCassette(filePath: string): Promise<CassetteFile | null> {
  const content = await readCassetteFile(filePath)
  if (content === null) return null
  return deserialize(content)
}
