import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execa } from '../../src/execa.js'
import { useCassette } from '../../src/use-cassette.js'

let tmp: string

const originalAck = process.env.SHELL_CASSETTE_ACK_REDACTION
const originalMode = process.env.SHELL_CASSETTE_MODE

function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = original
  }
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'shell-cassette-per-cassette-override-'))
  process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
  // Pin the mode so CI=true on the runner doesn't force replay-strict.
  process.env.SHELL_CASSETTE_MODE = 'auto'
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
  restoreEnv('SHELL_CASSETTE_ACK_REDACTION', originalAck)
  restoreEnv('SHELL_CASSETTE_MODE', originalMode)
})

describe('useCassette per-cassette redact override', () => {
  test('redact: true (default) redacts a credential in stdout', async () => {
    const cassettePath = path.join(tmp, 'redact-on.json')
    await useCassette(cassettePath, async () => {
      await execa('node', ['-e', `console.log('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')`])
    })
    const text = await readFile(cassettePath, 'utf8')
    expect(text).toContain('<redacted:stdout:github-pat-classic')
    expect(text).not.toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')
  })

  test('redact: false bypasses pipeline; raw credential persists in cassette', async () => {
    const cassettePath = path.join(tmp, 'redact-off.json')
    await useCassette(cassettePath, { redact: false }, async () => {
      await execa('node', ['-e', `console.log('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')`])
    })
    const text = await readFile(cassettePath, 'utf8')
    expect(text).toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')
    expect(text).not.toContain('<redacted:')
  })

  test('redact: false with credential in env bypasses env-key-match path', async () => {
    const cassettePath = path.join(tmp, 'redact-off-env.json')
    await useCassette(cassettePath, { redact: false }, async () => {
      await execa('node', ['-e', `console.log(process.env.MY_TOKEN ?? 'no-token')`], {
        env: { MY_TOKEN: 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890' },
      })
    })
    const text = await readFile(cassettePath, 'utf8')
    // Both stdout and env should contain the raw token (not redacted)
    expect(text).toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')
    expect(text).not.toContain('<redacted:')
  })

  test('redact: true with credential in env: curated key-match path redacts', async () => {
    const cassettePath = path.join(tmp, 'redact-on-env.json')
    await useCassette(cassettePath, async () => {
      await execa('node', ['-e', `console.log(process.env.MY_TOKEN ?? 'no-token')`], {
        env: { MY_TOKEN: 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890' },
      })
    })
    const text = await readFile(cassettePath, 'utf8')
    // env: MY_TOKEN contains curated substring TOKEN; whole value redacted via env-key-match rule
    expect(text).toContain('<redacted:env:env-key-match')
    // stdout: node prints the token; bundled github-pat-classic pattern fires
    expect(text).toContain('<redacted:stdout:github-pat-classic')
    // No raw credential anywhere in the cassette
    expect(text).not.toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')
  })
})
