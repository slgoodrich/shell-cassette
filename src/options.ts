import { UnsupportedOptionError } from './errors.js'

export function validateOptions(options: Record<string, unknown> | undefined): void {
  if (!options) return

  if (options.buffer === false) {
    throw new UnsupportedOptionError(
      'execa option `buffer: false` (streaming) not supported in v0.1. Planned for v1.0.',
    )
  }
  if (options.ipc === true) {
    throw new UnsupportedOptionError(
      'execa option `ipc: true` not supported in v0.1. Planned for v1.0.',
    )
  }
  if (options.inputFile !== undefined && options.inputFile !== null) {
    throw new UnsupportedOptionError(
      'execa option `inputFile` not supported in v0.1. Planned for v1.0.',
    )
  }
  if (options.input !== undefined && options.input !== null) {
    throw new UnsupportedOptionError(
      'execa option `input` (stdin) not supported in v0.1. Buffered stdin planned for v0.2.',
    )
  }
  if (options.node === true) {
    throw new UnsupportedOptionError(
      'execa option `node: true` (execaNode) not supported in v0.1. Planned for v0.2.',
    )
  }
}
