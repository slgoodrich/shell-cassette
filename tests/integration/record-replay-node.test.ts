import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { ReplayMissError } from '../../src/errors.js'
import { execa, execaNode } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { useRecordingEnv } from '../helpers/recording-env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

useRecordingEnv()

describe('record + replay with node: true and execaNode', () => {
  const tmp = useTmpDir('sc-node-flag-')

  test('execa(file, [], { node: true }) round-trips and replays', async () => {
    const cp = path.join(tmp.ref(), 'cassette.json')
    const script = path.join(tmp.ref(), 'hello.mjs')
    await writeFile(script, 'console.log("hello-node-flag")', 'utf8')

    let firstStdout: string | undefined
    await useCassette(cp, async () => {
      const r = await execa(script, [], { node: true })
      firstStdout = r.stdout
      expect(firstStdout).toBe('hello-node-flag')
    })

    await useCassette(cp, async () => {
      const r = await execa(script, [], { node: true })
      expect(r.stdout).toBe(firstStdout)
    })

    const cassette = JSON.parse(await readFile(cp, 'utf8'))
    expect(cassette.recordings).toHaveLength(1)
    // Call.command stores the user-provided file (not "node <file>"),
    // and the node flag is not stored anywhere in the cassette.
    expect(cassette.recordings[0].call.command).toBe(script)
    expect(JSON.stringify(cassette.recordings[0].call)).not.toContain('"node"')
  })

  test('execaNode(file) records and replays equivalently to execa with node:true', async () => {
    const cp = path.join(tmp.ref(), 'shared.json')
    const script = path.join(tmp.ref(), 'shared.mjs')
    await writeFile(script, 'console.log("shared")', 'utf8')

    // Record via execaNode.
    let firstStdout: string | undefined
    await useCassette(cp, async () => {
      const r = await execaNode(script, [])
      firstStdout = r.stdout
      expect(firstStdout).toBe('shared')
    })

    // Replay via execa with { node: true } against the same cassette: must
    // hit the same recording (canonical forms match; node flag is not in
    // the match-tuple).
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = await execa(script, [], { node: true })
        expect(r.stdout).toBe(firstStdout)
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })

  test('execa without node:true matches a recording made with execaNode (canonical form ignores node flag)', async () => {
    const cp = path.join(tmp.ref(), 'cross-flag.json')
    const script = path.join(tmp.ref(), 'cross.mjs')
    await writeFile(script, 'console.log("cross-flag")', 'utf8')

    // Record via execaNode (subprocess gets node-runtime treatment).
    await useCassette(cp, async () => {
      const r = await execaNode(script, [])
      expect(r.stdout).toBe('cross-flag')
    })

    // Replay without the node flag: still matches because canonical form
    // is identical. This is the intentional behavior the hint warns about.
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        const r = await execa(script, [])
        expect(r.stdout).toBe('cross-flag')
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })

  test('ReplayMissError appends node-flag hint when call passed node:true', async () => {
    const cp = path.join(tmp.ref(), 'miss.json')
    const script = path.join(tmp.ref(), 'miss.mjs')
    await writeFile(script, 'console.log("recorded")', 'utf8')

    // Record one call with specific args.
    await useCassette(cp, async () => {
      await execa(script, ['recorded-arg'], { node: true })
    })

    // Replay a different call with node:true; matcher misses, hint should fire.
    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        try {
          await execa(script, ['different-arg'], { node: true })
          throw new Error('should not reach')
        } catch (e) {
          expect(e).toBeInstanceOf(ReplayMissError)
          const msg = (e as Error).message
          expect(msg).toContain('canonical forms ignore the `node` flag')
          expect(msg).toContain('execaNode(f)')
        }
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })

  test('ReplayMissError omits node-flag hint when call did NOT pass node:true', async () => {
    const cp = path.join(tmp.ref(), 'no-hint.json')
    const script = path.join(tmp.ref(), 'no-hint.mjs')
    await writeFile(script, 'console.log("recorded")', 'utf8')

    // Invoke `node` explicitly rather than spawning the .mjs file directly.
    // On Linux, .mjs files are not executable without a shebang and the
    // exec bit; passing `node` as the command works cross-platform. The
    // hint logic checks `options.node === true`, not the command name, so
    // this still exercises the "no node flag" path.
    await useCassette(cp, async () => {
      await execa('node', [script, 'recorded-arg'])
    })

    process.env.SHELL_CASSETTE_MODE = 'replay'
    try {
      await useCassette(cp, async () => {
        try {
          await execa('node', [script, 'different-arg'])
          throw new Error('should not reach')
        } catch (e) {
          expect(e).toBeInstanceOf(ReplayMissError)
          const msg = (e as Error).message
          expect(msg).not.toContain('canonical forms ignore the `node` flag')
        }
      })
    } finally {
      process.env.SHELL_CASSETTE_MODE = 'auto'
    }
  })
})
