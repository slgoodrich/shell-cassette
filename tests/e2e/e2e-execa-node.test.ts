import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execaNode } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { restoreEnv } from '../helpers/env.js'

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
  test('execaNode runs a real Node script and round-trips through a cassette', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sc-e2e-execa-node-'))
    try {
      const cp = path.join(tmp, 'cassette.json')
      const script = path.join(tmp, 'greet.mjs')
      await writeFile(script, "console.log('pid=' + (process.pid > 0))", 'utf8')

      let firstStdout: string | undefined
      await useCassette(cp, async () => {
        const r = await execaNode(script, [])
        firstStdout = r.stdout
        expect(firstStdout).toBe('pid=true')
      })

      // Replay: no real subprocess needed.
      await useCassette(cp, async () => {
        const r = await execaNode(script, [])
        expect(r.stdout).toBe(firstStdout)
      })

      const cassette = JSON.parse(await readFile(cp, 'utf8'))
      expect(cassette.recordings).toHaveLength(1)
      // The user-supplied file is preserved as Call.command; "node" is not
      // prepended and the node flag is not stored.
      expect(cassette.recordings[0].call.command).toBe(script)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
