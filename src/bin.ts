#!/usr/bin/env node
import { main } from './cli.js'
/**
 * Bin entry point for the `shell-cassette` CLI. Exists separately from
 * `cli.ts` so we don't need a fragile self-detect to decide whether to
 * execute. `cli.ts` exports `main`; this file calls it unconditionally.
 *
 * package.json#bin points at this file.
 */
import { stderr } from './cli-output.js'

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    stderr(`error: ${(e as Error).message}`)
    process.exit(2)
  })
