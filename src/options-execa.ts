import { UnsupportedOptionError } from './errors.js'

export function validateOptions(options: Record<string, unknown> | undefined): void {
  if (!options) return

  if (options.buffer === false) {
    throw new UnsupportedOptionError(
      'execa option `buffer: false` (streaming) not supported. Tracked in backlog.',
    )
  }
  if (options.ipc === true) {
    throw new UnsupportedOptionError('execa option `ipc: true` not supported. Tracked in backlog.')
  }
  if (options.inputFile !== undefined && options.inputFile !== null) {
    throw new UnsupportedOptionError('execa option `inputFile` not supported. Tracked in backlog.')
  }
  if (options.input !== undefined && options.input !== null) {
    throw new UnsupportedOptionError(
      'execa option `input` (stdin) not supported. Buffered stdin tracked in backlog.',
    )
  }
  if (options.node === true) {
    throw new UnsupportedOptionError(
      'execa option `node: true` (execaNode) not supported. Tracked in backlog.',
    )
  }
}
