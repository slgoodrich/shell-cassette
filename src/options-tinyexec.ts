import { UnsupportedOptionError } from './errors.js'

export function validateOptions(options: Record<string, unknown> | undefined): void {
  if (!options) return

  if (options.persist === true) {
    throw new UnsupportedOptionError(
      'tinyexec option `persist: true` not supported. Subprocesses outliving the host process cannot be replayed.',
    )
  }

  if (options.stdin !== undefined && options.stdin !== null && typeof options.stdin !== 'string') {
    throw new UnsupportedOptionError(
      'tinyexec option `stdin` as Result (pipe chaining) not supported. Pass a string for buffered stdin.',
    )
  }
}
