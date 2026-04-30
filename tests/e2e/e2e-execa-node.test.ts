import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execaNode } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
const originalMode = process.env.SHELL_CASSETTE_MODE

beforeEach(() => {
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
  process.env.SHELL_CASSETTE_MODE = 'auto'
})

afterEach(() => {
  restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
  restoreEnv('SHELL_CASSETTE_MODE', originalMode)
})

describe('e2e execaNode', () => {
  const tmp = useTmpDir('sc-e2e-execa-node-')

  test('execaNode runs a real Node script and round-trips through a cassette', async () => {
    const dir = tmp.ref()
    const cp = path.join(dir, 'cassette.json')
    const script = path.join(dir, 'greet.mjs')
    await writeFile(script, "console.log('pid=' + (process.pid > 0))", 'utf8')

    let firstStdout: string | undefined
    await useCassette(cp, async () => {
      const r = await execaNode(script, [])
      firstStdout = r.stdout
      expect(firstStdout).toBe('pid=true')
    })

    await useCassette(cp, async () => {
      const r = await execaNode(script, [])
      expect(r.stdout).toBe(firstStdout)
    })

    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    expect(cassette.recordings).toHaveLength(1)
    expect(cassette.recordings[0].call.command).toBe(script)
  })
})
