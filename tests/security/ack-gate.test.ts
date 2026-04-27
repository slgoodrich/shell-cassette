import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { requireAckGate } from '../../src/ack.js'
import { AckRequiredError } from '../../src/errors.js'

const originalEnv = process.env.SHELL_CASSETTE_ACK_REDACTION

beforeEach(() => {
  delete process.env.SHELL_CASSETTE_ACK_REDACTION
})

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
  } else {
    process.env.SHELL_CASSETTE_ACK_REDACTION = originalEnv
  }
})

describe('requireAckGate', () => {
  test('throws AckRequiredError when env var unset', () => {
    expect(() => requireAckGate()).toThrow(AckRequiredError)
  })

  test('throws when env var is empty string', () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = ''
    expect(() => requireAckGate()).toThrow(AckRequiredError)
  })

  test('throws when env var is "false"', () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'false'
    expect(() => requireAckGate()).toThrow(AckRequiredError)
  })

  test('passes when env var is "true"', () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    expect(() => requireAckGate()).not.toThrow()
  })

  test('error message describes redaction scope and how to ack', () => {
    try {
      requireAckGate()
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('SHELL_CASSETTE_ACK_REDACTION')
      expect(msg).toContain('TOKEN')
      expect(msg).toContain('config.redact.envKeys')
    }
  })

  test('ack message lists 25 bundled credential patterns coverage', () => {
    try {
      requireAckGate()
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('25 bundled credential patterns')
      expect(msg).toContain('GitHub')
      expect(msg).toContain('AWS access key ID')
      expect(msg).toContain('Stripe')
      expect(msg).toContain('OpenAI')
      expect(msg).toContain('Anthropic')
    }
  })

  test('ack message names residual risks', () => {
    try {
      requireAckGate()
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('AWS Secret Access Keys')
      expect(msg).toContain('JWTs')
      expect(msg).toContain('cwd values')
      expect(msg).toContain('stdin')
    }
  })

  test('ack message references scan and re-redact CLIs', () => {
    try {
      requireAckGate()
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('shell-cassette scan')
      expect(msg).toContain('shell-cassette re-redact')
    }
  })

  test('ack message references config.redact.envKeys (not deprecated redactEnvKeys)', () => {
    try {
      requireAckGate()
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('config.redact.envKeys')
      expect(msg).not.toContain('redactEnvKeys')
    }
  })

  test('ack message references config.redact.customPatterns', () => {
    try {
      requireAckGate()
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('config.redact.customPatterns')
    }
  })

  test('one-shot toggle: env on then off → next call throws', () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    expect(() => requireAckGate()).not.toThrow()
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
    expect(() => requireAckGate()).toThrow(AckRequiredError)
  })
})
