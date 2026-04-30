import type { Options, ResultPromise } from 'execa'
import { MissingPeerDependencyError } from './errors.js'
import { readInputFile } from './io.js'
import { validateOptions } from './options-execa.js'
import type { Call, Recording, Result } from './types.js'
import { type RunnerHooks, runWrapped } from './wrapper.js'

// Resolve execa via dynamic import so we can wrap "Cannot find module" with
// an actionable error. Top-level await here means consumers importing
// shell-cassette/execa wait for this resolution. If execa isn't installed,
// shell-cassette/execa fails to load with a clear install instruction.
let realExeca: typeof import('execa').execa
try {
  const mod = await import('execa')
  realExeca = mod.execa
} catch (e) {
  throw new MissingPeerDependencyError(
    'shell-cassette/execa requires execa as a peer dependency.\n\n' +
      'Install it:\n' +
      '  npm install execa\n' +
      '  pnpm add execa\n' +
      '  yarn add execa\n\n' +
      `Original error: ${(e as Error).message}`,
  )
}

export function execa(
  file: string,
  args?: readonly string[],
  options?: Options,
): ResultPromise<Options> {
  return runWrapped(file, args ?? [], options ?? {}, execaHooks) as ResultPromise<Options>
}

// Mirrors real execa's `execaNode`: runs the script under the current Node
// runtime by forcing `node: true`. The user-provided file is preserved as
// `Call.command` (e.g. `'script.mjs'`, not `'node script.mjs'`), and the
// `node` flag is not stored in the cassette. So `execaNode(f)` and
// `execa(f, [], { node: true })` share recordings via canonical form.
export function execaNode(
  file: string,
  args?: readonly string[],
  options?: Options,
): ResultPromise<Options> {
  return execa(file, args, { ...options, node: true })
}

const execaHooks: RunnerHooks<Options, unknown> = {
  validate: (opts) => validateOptions(opts as Record<string, unknown> | undefined),
  buildCall,
  realCall: (file, args, options) => realExeca(file, args, options) as unknown as Promise<unknown>,
  captureResult,
  synthesize,
}

async function buildCall(file: string, args: readonly string[], options: Options): Promise<Call> {
  // Validator already rejected the invalid shapes (Uint8Array/Readable input,
  // input+inputFile conflict). At this point `input` is either undefined,
  // null, or a string; `inputFile` is either undefined or a string-like.
  let stdin: string | null = null
  if (typeof options.input === 'string') {
    stdin = options.input
  } else if (options.inputFile !== undefined) {
    // Strict-read: failure here propagates as BinaryInputError or
    // CassetteIOError. Reading before the matcher runs means binary input
    // throws before producing a misleading ReplayMissError.
    stdin = await readInputFile(options.inputFile as string | URL)
  }
  return {
    command: file,
    args: [...args],
    cwd: (options.cwd as string | undefined) ?? null,
    env: (options.env as Record<string, string> | undefined) ?? {},
    stdin,
  }
}

function captureResult(raw: unknown, durationMs: number): Result {
  const r = raw as {
    stdout?: string | string[]
    stderr?: string | string[]
    all?: string | string[]
    exitCode?: number
    signal?: string | null
    isCanceled?: boolean
  }
  return {
    stdoutLines: toLines(r.stdout),
    stderrLines: toLines(r.stderr),
    allLines: r.all === undefined ? null : toLines(r.all),
    exitCode: r.exitCode ?? 0,
    signal: r.signal ?? null,
    durationMs,
    aborted: r.isCanceled === true,
  }
}

function toLines(input: string | string[] | undefined): string[] {
  if (input === undefined) return ['']
  if (Array.isArray(input)) return [...input, '']
  return input.split('\n')
}

function synthesize(rec: Recording, options: Options): unknown {
  const stdout = rec.result.stdoutLines.join('\n')
  const stderr = rec.result.stderrLines.join('\n')
  const all =
    options.all === true ? (rec.result.allLines?.join('\n') ?? stdout + stderr) : undefined
  const result = {
    stdout: options.lines === true ? rec.result.stdoutLines.slice(0, -1) : stdout,
    stderr,
    exitCode: rec.result.exitCode,
    signal: rec.result.signal,
    durationMs: rec.result.durationMs,
    failed: rec.result.exitCode !== 0,
    timedOut: false,
    isCanceled: rec.result.aborted,
    killed: rec.result.signal !== null,
    command: `${rec.call.command} ${rec.call.args.join(' ')}`,
    escapedCommand: rec.call.command,
    ...(all !== undefined && { all }),
  }

  if (options.reject !== false && rec.result.exitCode !== 0) {
    const err = Object.assign(
      new Error(`Command failed with exit code ${rec.result.exitCode}: ${result.command}`),
      result,
      { name: 'ExecaError' },
    )
    throw err
  }

  return result
}
