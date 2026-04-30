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
  // `input` accepts strings only. Uint8Array and Readable are rejected because
  // shell-cassette stores stdin as UTF-8 in the cassette; binary or streaming
  // stdin would not round-trip. The check is shape-based, not strict-type, to
  // catch user mistakes (e.g. passing a Buffer) with a clear error.
  if (options.input !== undefined && options.input !== null && typeof options.input !== 'string') {
    throw new UnsupportedOptionError(
      'execa option `input` as Uint8Array or Readable not supported. ' +
        'shell-cassette currently accepts `input: string` only. Tracked in backlog.',
    )
  }
  // `input` and `inputFile` together is ambiguous: execa would silently prefer
  // one, and the cassette would store only one source of truth. Reject so the
  // user picks. Any non-undefined `input` (including null and empty string)
  // combined with a set `inputFile` triggers this.
  if (options.inputFile !== undefined && options.input !== undefined) {
    throw new UnsupportedOptionError(
      'execa options `input` and `inputFile` cannot be combined. Pick one source of stdin.',
    )
  }
}
