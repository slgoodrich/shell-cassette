import { describe, expect, test } from 'vitest'
import { DEFAULT_CONFIG, mergeWithDefaults, validateConfig } from '../../src/config.js'
import { CassetteConfigError, ShellCassetteError } from '../../src/errors.js'

describe('DEFAULT_CONFIG', () => {
  test('has cassetteDir = __cassettes__', () => {
    expect(DEFAULT_CONFIG.cassetteDir).toBe('__cassettes__')
  })

  test('default canonicalize returns command + args + stdin', () => {
    const call = { command: 'git', args: ['status'], cwd: null, env: {}, stdin: null } as const
    expect(DEFAULT_CONFIG.canonicalize(call, DEFAULT_CONFIG.redact)).toEqual({
      command: 'git',
      args: ['status'],
      stdin: null,
    })
  })
})

describe('mergeWithDefaults', () => {
  test('returns defaults when input is undefined', () => {
    const result = mergeWithDefaults(undefined)
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  test('returns defaults when input is empty', () => {
    const result = mergeWithDefaults({})
    expect(result.cassetteDir).toBe(DEFAULT_CONFIG.cassetteDir)
  })

  test('overrides cassetteDir', () => {
    const result = mergeWithDefaults({ cassetteDir: 'cassettes' })
    expect(result.cassetteDir).toBe('cassettes')
  })

  test('result is frozen', () => {
    const result = mergeWithDefaults({})
    expect(Object.isFrozen(result)).toBe(true)
  })
})

describe('validateConfig', () => {
  test('passes for empty input', () => {
    expect(() => validateConfig({})).not.toThrow()
  })

  test('throws CassetteConfigError on non-object', () => {
    expect(() => validateConfig(null)).toThrow(CassetteConfigError)
    expect(() => validateConfig(null)).toThrow(ShellCassetteError)
    expect(() => validateConfig('string')).toThrow(CassetteConfigError)
    expect(() => validateConfig('string')).toThrow(ShellCassetteError)
    expect(() => validateConfig(42)).toThrow(CassetteConfigError)
    expect(() => validateConfig(42)).toThrow(ShellCassetteError)
  })

  test('throws if cassetteDir is not string', () => {
    expect(() => validateConfig({ cassetteDir: 42 })).toThrow(CassetteConfigError)
    expect(() => validateConfig({ cassetteDir: 42 })).toThrow(ShellCassetteError)
  })

  test('throws if canonicalize is not function', () => {
    expect(() => validateConfig({ canonicalize: 'foo' })).toThrow(CassetteConfigError)
    expect(() => validateConfig({ canonicalize: 'foo' })).toThrow(ShellCassetteError)
  })
})

describe('Config defaults: redact field', () => {
  test('bundledPatterns defaults to true', () => {
    expect(DEFAULT_CONFIG.redact.bundledPatterns).toBe(true)
  })

  test('warnLengthThreshold defaults to 40', () => {
    expect(DEFAULT_CONFIG.redact.warnLengthThreshold).toBe(40)
  })

  test('warnPathHeuristic defaults to true', () => {
    expect(DEFAULT_CONFIG.redact.warnPathHeuristic).toBe(true)
  })

  test('customPatterns, suppressPatterns, envKeys default to empty arrays', () => {
    expect(DEFAULT_CONFIG.redact.customPatterns).toEqual([])
    expect(DEFAULT_CONFIG.redact.suppressPatterns).toEqual([])
    expect(DEFAULT_CONFIG.redact.envKeys).toEqual([])
  })

  test('suppressLengthWarningKeys defaults to empty array (additive to curated default)', () => {
    expect(DEFAULT_CONFIG.redact.suppressLengthWarningKeys).toEqual([])
  })
})

describe('mergeWithDefaults: redact field', () => {
  test('user-provided redact: { bundledPatterns: false }: only that field overridden', () => {
    const merged = mergeWithDefaults({ redact: { bundledPatterns: false } })
    expect(merged.redact.bundledPatterns).toBe(false)
    expect(merged.redact.warnLengthThreshold).toBe(40)
    expect(merged.redact.warnPathHeuristic).toBe(true)
  })

  test('custom rules pass through merge', () => {
    const rule = { name: 'my-rule', pattern: /SECRET-[A-Z]+/ }
    const merged = mergeWithDefaults({ redact: { customPatterns: [rule] } })
    expect(merged.redact.customPatterns).toEqual([rule])
  })

  test('suppress patterns pass through merge', () => {
    const sup = /^FAKE_/
    const merged = mergeWithDefaults({ redact: { suppressPatterns: [sup] } })
    expect(merged.redact.suppressPatterns).toEqual([sup])
  })

  test('warnLengthThreshold override', () => {
    const merged = mergeWithDefaults({ redact: { warnLengthThreshold: 60 } })
    expect(merged.redact.warnLengthThreshold).toBe(60)
  })

  test('warnPathHeuristic override', () => {
    const merged = mergeWithDefaults({ redact: { warnPathHeuristic: false } })
    expect(merged.redact.warnPathHeuristic).toBe(false)
  })

  test('returned redact object is frozen', () => {
    const merged = mergeWithDefaults({ redact: { bundledPatterns: false } })
    expect(Object.isFrozen(merged.redact)).toBe(true)
  })

  test('user-supplied customPatterns array is defensively copied and frozen', () => {
    const userArray = [{ name: 'my-rule', pattern: /A/ }]
    const merged = mergeWithDefaults({ redact: { customPatterns: userArray } })
    expect(Object.isFrozen(merged.redact.customPatterns)).toBe(true)
    // Mutating the original user array does NOT affect merged
    userArray.push({ name: 'sneaky', pattern: /B/ })
    expect(merged.redact.customPatterns.length).toBe(1)
  })

  test('user-supplied suppressPatterns array is defensively copied and frozen', () => {
    const userArray = [/^FAKE_/]
    const merged = mergeWithDefaults({ redact: { suppressPatterns: userArray } })
    expect(Object.isFrozen(merged.redact.suppressPatterns)).toBe(true)
    userArray.push(/^OTHER_/)
    expect(merged.redact.suppressPatterns.length).toBe(1)
  })

  test('user-supplied envKeys array is defensively copied and frozen', () => {
    const userArray = ['STRIPE_KEY']
    const merged = mergeWithDefaults({ redact: { envKeys: userArray } })
    expect(Object.isFrozen(merged.redact.envKeys)).toBe(true)
    userArray.push('OPENAI_KEY')
    expect(merged.redact.envKeys.length).toBe(1)
  })

  test('user-supplied suppressLengthWarningKeys array is defensively copied and frozen', () => {
    const userArray = ['MY_PROJECT_VAR']
    const merged = mergeWithDefaults({ redact: { suppressLengthWarningKeys: userArray } })
    expect(Object.isFrozen(merged.redact.suppressLengthWarningKeys)).toBe(true)
    userArray.push('OTHER')
    expect(merged.redact.suppressLengthWarningKeys.length).toBe(1)
  })
})

describe('validateConfig: redact field', () => {
  test('accepts a custom rule with a regex (no g flag required)', () => {
    expect(() =>
      validateConfig({
        redact: {
          customPatterns: [{ name: 'my-rule', pattern: /SECRET-[A-Z]+/ }],
        },
      }),
    ).not.toThrow()
  })

  test('accepts a custom rule with a g-flagged regex', () => {
    expect(() =>
      validateConfig({
        redact: {
          customPatterns: [{ name: 'my-rule', pattern: /SECRET-[A-Z]+/g }],
        },
      }),
    ).not.toThrow()
  })

  test('accepts a custom rule with a function pattern', () => {
    expect(() =>
      validateConfig({
        redact: {
          customPatterns: [{ name: 'my-fn', pattern: (s: string) => s.toUpperCase() }],
        },
      }),
    ).not.toThrow()
  })

  test('rejects custom rule with non-kebab-case name', () => {
    expect(() =>
      validateConfig({
        redact: { customPatterns: [{ name: 'BadName', pattern: /A/ }] },
      }),
    ).toThrow(/kebab-case/)
  })

  test('rejects custom rule with empty name', () => {
    const trigger = () =>
      validateConfig({
        redact: { customPatterns: [{ name: '', pattern: /A/ }] },
      })
    expect(trigger).toThrow(CassetteConfigError)
    expect(trigger).toThrow(ShellCassetteError)
  })

  test('rejects duplicate custom rule names', () => {
    expect(() =>
      validateConfig({
        redact: {
          customPatterns: [
            { name: 'dupe', pattern: /A/ },
            { name: 'dupe', pattern: /B/ },
          ],
        },
      }),
    ).toThrow(/duplicated/)
  })

  test('rejects custom rule with neither RegExp nor function pattern', () => {
    expect(() =>
      validateConfig({
        redact: {
          customPatterns: [{ name: 'bad', pattern: 'not-a-regex' as unknown as RegExp }],
        },
      }),
    ).toThrow(/RegExp or function/)
  })

  test('rejects suppress entries that are not RegExp', () => {
    expect(() =>
      validateConfig({
        redact: { suppressPatterns: ['not-a-regex' as unknown as RegExp] },
      }),
    ).toThrow(/RegExp/)
  })

  test('rejects negative warnLengthThreshold', () => {
    expect(() => validateConfig({ redact: { warnLengthThreshold: -1 } })).toThrow(
      /positive integer/,
    )
  })

  test('rejects zero warnLengthThreshold', () => {
    expect(() => validateConfig({ redact: { warnLengthThreshold: 0 } })).toThrow(/positive integer/)
  })

  test('rejects non-integer warnLengthThreshold', () => {
    expect(() => validateConfig({ redact: { warnLengthThreshold: 40.5 } })).toThrow(
      /positive integer/,
    )
  })

  test('rejects non-boolean bundledPatterns', () => {
    expect(() => validateConfig({ redact: { bundledPatterns: 'yes' } })).toThrow(/boolean/)
  })

  test('rejects non-boolean warnPathHeuristic', () => {
    expect(() => validateConfig({ redact: { warnPathHeuristic: 'yes' } })).toThrow(/boolean/)
  })

  test('rejects non-array customPatterns', () => {
    expect(() => validateConfig({ redact: { customPatterns: 'foo' } })).toThrow(/array/)
  })

  test('rejects non-array suppressPatterns', () => {
    expect(() => validateConfig({ redact: { suppressPatterns: 'foo' } })).toThrow(/array/)
  })

  test('rejects non-array envKeys', () => {
    expect(() => validateConfig({ redact: { envKeys: 'foo' } })).toThrow(
      /envKeys must be an array$/,
    )
  })

  test('rejects envKeys with non-string entries', () => {
    expect(() => validateConfig({ redact: { envKeys: [1, 2] } })).toThrow(
      /items must all be strings/,
    )
  })

  test('rejects non-array suppressLengthWarningKeys', () => {
    expect(() => validateConfig({ redact: { suppressLengthWarningKeys: 'foo' } })).toThrow(
      /suppressLengthWarningKeys must be an array$/,
    )
  })

  test('rejects suppressLengthWarningKeys with non-string entries', () => {
    expect(() => validateConfig({ redact: { suppressLengthWarningKeys: [1, 2] } })).toThrow(
      /suppressLengthWarningKeys items must all be strings/,
    )
  })

  test('rejects non-object redact', () => {
    expect(() => validateConfig({ redact: 'foo' })).toThrow(/must be an object/)
  })

  test('user can opt out of bundle by setting bundledPatterns: false', () => {
    expect(() => validateConfig({ redact: { bundledPatterns: false } })).not.toThrow()
    const merged = mergeWithDefaults({ redact: { bundledPatterns: false } })
    expect(merged.redact.bundledPatterns).toBe(false)
  })

  test('accepts custom rule with valid description', () => {
    expect(() =>
      validateConfig({
        redact: {
          customPatterns: [{ name: 'my-rule', pattern: /A/, description: 'matches A' }],
        },
      }),
    ).not.toThrow()
  })

  test('accepts custom rule without description', () => {
    expect(() =>
      validateConfig({
        redact: {
          customPatterns: [{ name: 'my-rule', pattern: /A/ }],
        },
      }),
    ).not.toThrow()
  })

  test('rejects custom rule with non-string description', () => {
    expect(() =>
      validateConfig({
        redact: {
          customPatterns: [
            { name: 'my-rule', pattern: /A/, description: 123 as unknown as string },
          ],
        },
      }),
    ).toThrow(/description must be a string/)
  })
})
