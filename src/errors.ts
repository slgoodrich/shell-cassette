export class ShellCassetteError extends Error {
  static code = 'CASSETTE_GENERIC'

  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class AckRequiredError extends ShellCassetteError {
  static override code = 'CASSETTE_ACK_REQUIRED'
}

export class UnsupportedOptionError extends ShellCassetteError {
  static override code = 'CASSETTE_UNSUPPORTED_OPTION'
}

export class ReplayMissError extends ShellCassetteError {
  static override code = 'CASSETTE_REPLAY_MISS'
}

export class ConcurrencyError extends ShellCassetteError {
  static override code = 'CASSETTE_CONCURRENT'
}

export class BinaryOutputError extends ShellCassetteError {
  static override code = 'CASSETTE_BINARY_OUTPUT'
}

export class CassetteCorruptError extends ShellCassetteError {
  static override code = 'CASSETTE_CORRUPT'
}

export class CassetteCollisionError extends ShellCassetteError {
  static override code = 'CASSETTE_COLLISION'
}

export class CassetteIOError extends ShellCassetteError {
  static override code = 'CASSETTE_IO'

  constructor(
    message: string,
    public override readonly cause: Error,
  ) {
    super(message)
  }
}

export class CassetteNotFoundError extends ShellCassetteError {
  static override code = 'CASSETTE_NOT_FOUND'

  constructor(public readonly path: string) {
    super(`cassette file not found: ${path}`)
  }
}

export class CassetteConfigError extends ShellCassetteError {
  static override code = 'CASSETTE_CONFIG'
}

export class MissingPeerDependencyError extends ShellCassetteError {
  static override code = 'CASSETTE_MISSING_PEER_DEP'
}

export class NoActiveSessionError extends ShellCassetteError {
  static override code = 'CASSETTE_NO_ACTIVE_SESSION'
}

export class VitestPluginRegistrationError extends ShellCassetteError {
  static override code = 'CASSETTE_VITEST_PLUGIN_REGISTRATION'
}

/**
 * Thrown from code paths that should be unreachable when the implementation
 * is correct (e.g., exhaustiveness guards on discriminated unions where
 * `default: const _: never = x` proves the case at compile time). Always
 * indicates an internal bug, not a user error. Programmatic catches on
 * `ShellCassetteError` still pick it up.
 *
 * Per `error_handling.md` "Internal Invariants": typed subclass over plain
 * `Error` so `instanceof ShellCassetteError` user catches don't miss it.
 */
export class CassetteInternalError extends ShellCassetteError {
  static override code = 'CASSETTE_INTERNAL'
}
