import { describe, expect, test } from 'vitest'
import { ShellCassetteError, VitestPluginRegistrationError } from '../../src/errors.js'
import { wrapRegistrationError } from '../../src/vitest-error.js'

describe('wrapRegistrationError', () => {
  test('wraps an Error in VitestPluginRegistrationError', () => {
    const original = new Error('Vitest failed to find the runner')
    const wrapped = wrapRegistrationError(original)
    expect(wrapped).toBeInstanceOf(VitestPluginRegistrationError)
    expect(wrapped).toBeInstanceOf(ShellCassetteError)
  })

  test('message preserves original error message', () => {
    const original = new Error('Vitest failed to find the runner')
    const wrapped = wrapRegistrationError(original)
    expect(wrapped.message).toContain('Vitest failed to find the runner')
  })

  test('message includes deps.inline fix paths for vitest 3.x and 4.x', () => {
    const wrapped = wrapRegistrationError(new Error('any error'))
    expect(wrapped.message).toContain('vitest 3.x')
    expect(wrapped.message).toContain('vitest 4.x')
    // vitest 3.x form
    expect(wrapped.message).toContain('server: { deps: { inline:')
    // vitest 4.x form
    expect(wrapped.message).toContain('deps: { inline: ["shell-cassette"]')
  })

  test('message includes a docs link', () => {
    const wrapped = wrapRegistrationError(new Error('any error'))
    expect(wrapped.message).toContain('docs/troubleshooting.md')
  })

  test('non-Error throws are coerced to Error before wrapping', () => {
    const wrapped = wrapRegistrationError('a string was thrown')
    expect(wrapped).toBeInstanceOf(VitestPluginRegistrationError)
    expect(wrapped.message).toContain('a string was thrown')
  })

  test('undefined throw still produces a wrapped message with deps.inline guidance', () => {
    const wrapped = wrapRegistrationError(undefined)
    expect(wrapped).toBeInstanceOf(VitestPluginRegistrationError)
    // No dead-end message when the original "error" was undefined.
    expect(wrapped.message).toContain('deps: { inline:')
  })
})
