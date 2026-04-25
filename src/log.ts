export function log(message: string): void {
  if (process.env.SHELL_CASSETTE_LOG === 'silent') return
  process.stderr.write(`shell-cassette: ${message}\n`)
}
