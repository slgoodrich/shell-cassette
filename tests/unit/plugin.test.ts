import { describe, expect, test } from 'vitest'
import { deriveCassettePathFromTask } from '../../src/plugin.js'

describe('deriveCassettePathFromTask', () => {
  test('flat test produces correct path', () => {
    const task = {
      name: 'finds branch',
      file: { filepath: '/repo/src/git.test.ts' },
      suite: undefined,
      concurrent: false,
    }
    const result = deriveCassettePathFromTask(task as never, '__cassettes__')
    expect(result).toBe('/repo/src/__cassettes__/git.test.ts/finds-branch.json')
  })

  test('nested describe produces nested path', () => {
    const task = {
      name: 'reads HEAD',
      file: { filepath: '/repo/src/git.test.ts' },
      suite: {
        name: 'inner',
        suite: {
          name: 'outer',
          suite: undefined,
        },
      },
      concurrent: false,
    }
    const result = deriveCassettePathFromTask(task as never, '__cassettes__')
    expect(result).toBe('/repo/src/__cassettes__/git.test.ts/outer/inner/reads-head.json')
  })

  test('throws ConcurrencyError if task.concurrent is true', () => {
    const task = {
      name: 'concurrent test',
      file: { filepath: '/repo/x.test.ts' },
      suite: undefined,
      concurrent: true,
    }
    expect(() => deriveCassettePathFromTask(task as never, '__cassettes__')).toThrow(/concurrent/)
  })
})
