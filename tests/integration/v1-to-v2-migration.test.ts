import { copyFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { runReRedact } from '../../src/cli-re-redact.js'
import { deserialize } from '../../src/serialize.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const FIXTURES = path.resolve('tests/fixtures/cassettes')

describe('v1 -> v2 migration via re-redact', () => {
  const tmp = useTmpDir('shell-cassette-mig-')

  test('v1 cassette upgrades to v2 with recordedBy and redactions populated', async () => {
    const target = path.join(tmp.ref(), 'foo.json')
    await copyFile(path.join(FIXTURES, 'v1-pre-redact.json'), target)

    const code = await runReRedact([target, '--quiet'])
    expect(code).toBe(1)

    const text = await readFile(target, 'utf8')
    const parsed = deserialize(text)
    expect(parsed.version).toBe(2)
    expect(parsed.recordedBy).not.toBeNull()
    expect(parsed.recordedBy?.name).toBe('shell-cassette')
    expect(parsed.recordings[0].redactions).toEqual([
      { rule: 'github-pat-classic', source: 'args', count: 1 },
    ])
    expect(parsed.recordings[0].call.args[1]).toBe(
      'Authorization: Bearer <redacted:args:github-pat-classic:1>',
    )
  })

  test('after v1 -> v2 upgrade, second re-redact run is a no-op', async () => {
    const target = path.join(tmp.ref(), 'foo.json')
    await copyFile(path.join(FIXTURES, 'v1-pre-redact.json'), target)

    await runReRedact([target, '--quiet'])
    const code = await runReRedact([target, '--quiet'])
    expect(code).toBe(0)
  })
})
