import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { loadConfigFromDir } from '../../src/config.js'
import { CassetteConfigError } from '../../src/errors.js'

describe('loadConfigFromDir', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-config-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('returns default config when no file found', async () => {
    const config = await loadConfigFromDir(tmp)
    expect(config.cassetteDir).toBe('__cassettes__')
  })

  test('loads .js config file', async () => {
    await writeFile(
      path.join(tmp, 'shell-cassette.config.js'),
      `export default { cassetteDir: 'custom-cassettes' }`,
    )
    const config = await loadConfigFromDir(tmp)
    expect(config.cassetteDir).toBe('custom-cassettes')
  })

  test('loads .mjs config file', async () => {
    await writeFile(
      path.join(tmp, 'shell-cassette.config.mjs'),
      `export default { redactEnvKeys: ['STRIPE_KEY'] }`,
    )
    const config = await loadConfigFromDir(tmp)
    expect(config.redactEnvKeys).toEqual(['STRIPE_KEY'])
  })

  test('throws CassetteConfigError on syntax error in config', async () => {
    await writeFile(
      path.join(tmp, 'shell-cassette.config.js'),
      'export default { syntax error here',
    )
    await expect(loadConfigFromDir(tmp)).rejects.toThrow(CassetteConfigError)
  })

  test('throws CassetteConfigError on invalid config shape', async () => {
    await writeFile(
      path.join(tmp, 'shell-cassette.config.js'),
      'export default { cassetteDir: 42 }',
    )
    await expect(loadConfigFromDir(tmp)).rejects.toThrow(CassetteConfigError)
  })

  test('walks up parent directories looking for config', async () => {
    const subdir = path.join(tmp, 'a', 'b')
    await mkdir(subdir, { recursive: true })
    await writeFile(
      path.join(tmp, 'shell-cassette.config.js'),
      `export default { cassetteDir: 'parent-cassettes' }`,
    )
    const config = await loadConfigFromDir(subdir)
    expect(config.cassetteDir).toBe('parent-cassettes')
  })
})
