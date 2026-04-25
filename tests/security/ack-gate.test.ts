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
      expect(msg).toContain('stdout')
    }
  })

  test('one-shot toggle: env on then off → next call throws', () => {
    process.env.SHELL_CASSETTE_ACK_REDACTION = 'true'
    expect(() => requireAckGate()).not.toThrow()
    delete process.env.SHELL_CASSETTE_ACK_REDACTION
    expect(() => requireAckGate()).toThrow(AckRequiredError)
  })
})
