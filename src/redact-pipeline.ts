import type { RedactConfig, RedactionEntry, RedactSource } from './types.js'

export type RedactInput = {
  source: RedactSource
  value: string
}

export type RedactOptions = {
  counted: boolean
  counters?: Map<string, number>
}

export type RedactOutput = {
  output: string
  entries: RedactionEntry[]
  warnings: string[]
}

export function runPipeline(
  input: RedactInput,
  config: Readonly<RedactConfig>,
  options: RedactOptions,
): RedactOutput {
  const { value } = input
  const entries: RedactionEntry[] = []
  const warnings: string[] = []

  for (const sup of config.suppressPatterns) {
    if (sup.test(value)) {
      return { output: value, entries, warnings }
    }
  }

  return { output: value, entries, warnings }
}

export function stripCounter(s: string): string {
  return s
}
