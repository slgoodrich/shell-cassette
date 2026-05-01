import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadConfigFromDir } from '../../src/config.js'
import { CassetteConfigError, ShellCassetteError } from '../../src/errors.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

describe('loadConfigFromDir', () => {
  const tmpDir = useTmpDir('shell-cassette-config-')

  test('returns default config when no file found', async () => {
    const config = await loadConfigFromDir(tmpDir.ref())
    expect(config.cassetteDir).toBe('__cassettes__')
  })

  test('loads .js config file', async () => {
    await writeFile(
      path.join(tmpDir.ref(), 'shell-cassette.config.js'),
      `export default { cassetteDir: 'custom-cassettes' }`,
    )
    const config = await loadConfigFromDir(tmpDir.ref())
    expect(config.cassetteDir).toBe('custom-cassettes')
  })

  test('loads .mjs config file', async () => {
    await writeFile(
      path.join(tmpDir.ref(), 'shell-cassette.config.mjs'),
      `export default { redact: { envKeys: ['STRIPE_KEY'] } }`,
    )
    const config = await loadConfigFromDir(tmpDir.ref())
    expect(config.redact.envKeys).toEqual(['STRIPE_KEY'])
  })

  test('throws CassetteConfigError on syntax error in config', async () => {
    await writeFile(
      path.join(tmpDir.ref(), 'shell-cassette.config.js'),
      'export default { syntax error here',
    )
    await expect(loadConfigFromDir(tmpDir.ref())).rejects.toThrow(CassetteConfigError)
    await expect(loadConfigFromDir(tmpDir.ref())).rejects.toThrow(ShellCassetteError)
  })

  test('throws CassetteConfigError on invalid config shape', async () => {
    await writeFile(
      path.join(tmpDir.ref(), 'shell-cassette.config.js'),
      'export default { cassetteDir: 42 }',
    )
    await expect(loadConfigFromDir(tmpDir.ref())).rejects.toThrow(CassetteConfigError)
    await expect(loadConfigFromDir(tmpDir.ref())).rejects.toThrow(ShellCassetteError)
  })

  test('walks up parent directories looking for config', async () => {
    const subdir = path.join(tmpDir.ref(), 'a', 'b')
    await mkdir(subdir, { recursive: true })
    await writeFile(
      path.join(tmpDir.ref(), 'shell-cassette.config.js'),
      `export default { cassetteDir: 'parent-cassettes' }`,
    )
    const config = await loadConfigFromDir(subdir)
    expect(config.cassetteDir).toBe('parent-cassettes')
  })
})
