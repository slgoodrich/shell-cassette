import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'
import { SAMPLE_GITHUB_PAT_CLASSIC } from '../helpers/credential-fixtures.js'
import { restoreEnv } from '../helpers/env.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const tmpDir = useTmpDir('shell-cassette-per-cassette-override-')

const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
const originalMode = process.env.SHELL_CASSETTE_MODE

const FAKE_PAT = SAMPLE_GITHUB_PAT_CLASSIC

beforeEach(() => {
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
  // Pin the mode so CI=true on the runner doesn't force replay-strict.
  process.env.SHELL_CASSETTE_MODE = 'auto'
})

afterEach(() => {
  restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
  restoreEnv('SHELL_CASSETTE_MODE', originalMode)
})

describe('useCassette per-cassette redact override', () => {
  test('redact: true (default) redacts a credential in stdout', async () => {
    const cassettePath = path.join(tmpDir.ref(), 'redact-on.json')
    await useCassette(cassettePath, async () => {
      await execa('node', ['-e', `console.log('${FAKE_PAT}')`])
    })
    const text = await readFile(cassettePath, 'utf8')
    expect(text).toContain('<redacted:stdout:github-pat-classic')
    expect(text).not.toContain(FAKE_PAT)
  })

  test('redact: false bypasses pipeline; raw credential persists in cassette', async () => {
    const cassettePath = path.join(tmpDir.ref(), 'redact-off.json')
    await useCassette(cassettePath, { redact: false }, async () => {
      await execa('node', ['-e', `console.log('${FAKE_PAT}')`])
    })
    const text = await readFile(cassettePath, 'utf8')
    expect(text).toContain(FAKE_PAT)
    expect(text).not.toContain('<redacted:')
  })

  test('redact: false with credential in env bypasses env-key-match path', async () => {
    const cassettePath = path.join(tmpDir.ref(), 'redact-off-env.json')
    await useCassette(cassettePath, { redact: false }, async () => {
      await execa('node', ['-e', `console.log(process.env.MY_TOKEN ?? 'no-token')`], {
        env: { MY_TOKEN: FAKE_PAT },
      })
    })
    const text = await readFile(cassettePath, 'utf8')
    expect(text).toContain(FAKE_PAT)
    expect(text).not.toContain('<redacted:env:')
    expect(text).not.toContain('<redacted:stdout:')
  })

  test('redact: true with credential in env: curated key-match path redacts', async () => {
    const cassettePath = path.join(tmpDir.ref(), 'redact-on-env.json')
    await useCassette(cassettePath, async () => {
      await execa('node', ['-e', `console.log(process.env.MY_TOKEN ?? 'no-token')`], {
        env: { MY_TOKEN: FAKE_PAT },
      })
    })
    const text = await readFile(cassettePath, 'utf8')
    // env: MY_TOKEN contains curated substring TOKEN; whole value redacted via env-key-match rule
    expect(text).toContain('<redacted:env:env-key-match')
    // stdout: node prints the token; bundled github-pat-classic pattern fires
    expect(text).toContain('<redacted:stdout:github-pat-classic')
    // No raw credential anywhere in the cassette
    expect(text).not.toContain(FAKE_PAT)
  })
})
