import { describe, expect, test, vi } from 'vitest'
import { ShellCassetteError } from '../../src/errors.js'
import { shellCassetteAlias } from '../../src/vite-plugin.js'

describe('shellCassetteAlias', () => {
  test('returns a plugin shape with name and resolveId', () => {
    const plugin = shellCassetteAlias()
    expect(plugin.name).toBe('shell-cassette-alias')
    expect(plugin.enforce).toBe('pre')
    expect(typeof plugin.resolveId).toBe('function')
  })

  test('default adapters list is [tinyexec]', async () => {
    const plugin = shellCassetteAlias()
    const ctx = {
      resolve: vi.fn().mockResolvedValue({ id: '/abs/path/to/shell-cassette/tinyexec' }),
    }

    const tinyexecResult = await plugin.resolveId.call(ctx, 'tinyexec', '/some/user/file.ts')
    expect(tinyexecResult).toBe('/abs/path/to/shell-cassette/tinyexec')
    expect(ctx.resolve).toHaveBeenCalledWith('shell-cassette/tinyexec', '/some/user/file.ts')

    // execa is NOT in the default list, so it should pass through unchanged
    ctx.resolve.mockClear()
    const execaResult = await plugin.resolveId.call(ctx, 'execa', '/some/user/file.ts')
    expect(execaResult).toBeNull()
    expect(ctx.resolve).not.toHaveBeenCalled()
  })

  test('adapters: ["execa"] redirects execa imports', async () => {
    const plugin = shellCassetteAlias({ adapters: ['execa'] })
    const ctx = { resolve: vi.fn().mockResolvedValue({ id: '/abs/path/to/shell-cassette/execa' }) }

    const result = await plugin.resolveId.call(ctx, 'execa', '/user/file.ts')
    expect(result).toBe('/abs/path/to/shell-cassette/execa')
    expect(ctx.resolve).toHaveBeenCalledWith('shell-cassette/execa', '/user/file.ts')
  })

  test('importer-conditioned: shell-cassette internal imports are NOT redirected', async () => {
    const plugin = shellCassetteAlias({ adapters: ['tinyexec'] })
    const ctx = { resolve: vi.fn() }

    // Importer is itself part of shell-cassette: should pass through
    const result = await plugin.resolveId.call(
      ctx,
      'tinyexec',
      '/node_modules/shell-cassette/dist/tinyexec.js',
    )
    expect(result).toBeNull()
    expect(ctx.resolve).not.toHaveBeenCalled()
  })

  test('non-adapter ids pass through (no redirect)', async () => {
    const plugin = shellCassetteAlias({ adapters: ['tinyexec'] })
    const ctx = { resolve: vi.fn() }

    const result = await plugin.resolveId.call(ctx, 'lodash', '/user/file.ts')
    expect(result).toBeNull()
    expect(ctx.resolve).not.toHaveBeenCalled()
  })

  test('rejects unknown adapter names with ShellCassetteError', () => {
    expect(() => shellCassetteAlias({ adapters: ['nope' as 'tinyexec'] })).toThrow(
      ShellCassetteError,
    )
    try {
      shellCassetteAlias({ adapters: ['nope' as 'tinyexec'] })
    } catch (e) {
      expect((e as Error).message).toContain('unknown adapter "nope"')
      expect((e as Error).message).toContain('tinyexec')
      expect((e as Error).message).toContain('execa')
    }
  })

  test('null resolve result returns null (does not throw)', async () => {
    const plugin = shellCassetteAlias({ adapters: ['tinyexec'] })
    const ctx = { resolve: vi.fn().mockResolvedValue(null) }

    const result = await plugin.resolveId.call(ctx, 'tinyexec', '/user/file.ts')
    expect(result).toBeNull()
  })
})
