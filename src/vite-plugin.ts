/**
 * Vite/Vitest plugin helper that redirects imports of subprocess libraries
 * (tinyexec, execa) to their shell-cassette adapters, with the importer
 * conditioned so shell-cassette's OWN internal imports of those libraries
 * are not redirected. Without this guard, a naive `resolve.alias: { tinyexec:
 * 'shell-cassette/tinyexec' }` config makes shell-cassette's adapter resolve
 * itself, causing an infinite import loop or runtime crash.
 *
 * Usage:
 *
 * ```ts
 * import { defineConfig } from 'vitest/config'
 * import { shellCassetteAlias } from 'shell-cassette/vite-plugin'
 *
 * export default defineConfig({
 *   plugins: [shellCassetteAlias({ adapters: ['tinyexec'] })],
 *   test: {
 *     setupFiles: ['shell-cassette/vitest'],
 *   },
 * })
 * ```
 *
 * Closes #84.
 */

import { ShellCassetteError } from './errors.js'

const VALID_ADAPTERS = ['execa', 'tinyexec'] as const
type Adapter = (typeof VALID_ADAPTERS)[number]

export type ShellCassetteAliasOptions = {
  /**
   * Subprocess libraries to redirect through shell-cassette adapters. Each
   * entry must be the bare module name as imported in user code. Default:
   * ['tinyexec'] (shell-cassette's most common adapter).
   */
  adapters?: readonly Adapter[]
}

/**
 * Minimal duck-typed plugin shape. Mirrors the subset of vite/rollup's Plugin
 * type that we actually use. Avoids a hard dependency on vite types so this
 * helper works for any rollup-compatible bundler that consumes the plugin.
 */
type PluginShape = {
  name: string
  enforce?: 'pre' | 'post'
  resolveId: (
    this: {
      resolve: (id: string, importer?: string) => Promise<{ id: string } | null>
    },
    id: string,
    importer: string | undefined,
  ) => Promise<string | null>
}

/**
 * Build a vite/rollup plugin that redirects bare imports of `adapters` to
 * the matching `shell-cassette/<adapter>` paths, EXCEPT when the importer
 * is itself part of shell-cassette (avoids the self-loop).
 */
export function shellCassetteAlias(options: ShellCassetteAliasOptions = {}): PluginShape {
  const adapters = options.adapters ?? ['tinyexec']
  for (const a of adapters) {
    if (!VALID_ADAPTERS.includes(a)) {
      throw new ShellCassetteError(
        `shellCassetteAlias: unknown adapter "${a}". Supported: ${VALID_ADAPTERS.join(', ')}.`,
      )
    }
  }
  const adapterSet: ReadonlySet<string> = new Set(adapters)

  return {
    name: 'shell-cassette-alias',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!adapterSet.has(id)) return null
      // Don't redirect imports made BY shell-cassette itself; that would
      // cause shell-cassette/<adapter> to re-resolve to itself, infinite loop.
      if (importer?.includes('shell-cassette')) return null
      const resolved = await this.resolve(`shell-cassette/${id}`, importer)
      return resolved ? resolved.id : null
    },
  }
}
