import { ShellCassetteError } from './errors.js'

/**
 * `shell-cassette re-redact` subcommand stub. M11 will fill the implementation
 * with re-application of current redaction rules over existing cassettes; for
 * now this stub keeps the binary's argv dispatch wired so M9 ships a working
 * entry point.
 */
export async function runReRedact(_args: readonly string[]): Promise<number> {
  throw new ShellCassetteError('runReRedact not implemented (stub for M9 wiring; M11 implements)')
}
