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

export class CassetteConfigError extends ShellCassetteError {
  static override code = 'CASSETTE_CONFIG'
}

export class MissingPeerDependencyError extends ShellCassetteError {
  static override code = 'CASSETTE_MISSING_PEER_DEP'
}

export class NoActiveSessionError extends ShellCassetteError {
  static override code = 'CASSETTE_NO_ACTIVE_SESSION'
}
