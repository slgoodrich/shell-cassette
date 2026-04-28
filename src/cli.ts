import { stderr, stdout } from './cli-output.js'
import { runReRedact } from './cli-re-redact.js'
import { runScan } from './cli-scan.js'
import { runShow } from './cli-show.js'
import { PACKAGE_VERSION } from './version.js'

const HELP = `\
shell-cassette ${PACKAGE_VERSION}

Usage:
  shell-cassette <command> [options] [args...]

Commands:
  scan        Verify cassettes have no unredacted credentials.
  re-redact   Re-apply current redaction rules to existing cassettes.
  show        Pretty-print a cassette for human inspection.

Options:
  --version   Print shell-cassette version and exit.
  --help      Print this help and exit.

Run 'shell-cassette <command> --help' for command-specific help.
`

type TopLevel = {
  help?: boolean
  version?: boolean
  command?: string
  rest: string[]
}

export function parseTopLevel(argv: readonly string[]): TopLevel {
  if (argv.length === 0) return { rest: [] }
  const [first, ...rest] = argv
  if (first === '--help' || first === '-h') return { help: true, rest: [] }
  if (first === '--version' || first === '-V') return { version: true, rest: [] }
  return { command: first, rest }
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseTopLevel(argv)
  if (args.help) {
    stdout(HELP)
    return 0
  }
  if (args.version) {
    stdout(PACKAGE_VERSION)
    return 0
  }
  if (!args.command) {
    stderr(`error: missing command\n${HELP}`)
    return 2
  }

  switch (args.command) {
    case 'scan':
      return runScan(args.rest)
    case 're-redact':
      return runReRedact(args.rest)
    case 'show':
      return runShow(args.rest)
    default:
      stderr(`error: unknown command '${args.command}'\n${HELP}`)
      return 2
  }
}
