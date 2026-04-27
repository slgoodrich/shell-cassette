const LONG_VALUE_THRESHOLD = 100

export const CURATED_KEYS = [
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'APIKEY',
  'API_KEY',
  'CREDENTIAL',
  'PRIVATE_KEY',
  'AUTH_TOKEN',
  'BEARER_TOKEN',
  'JWT',
] as const

export type RedactConfig = {
  redactEnvKeys: string[]
}

export type RedactResult = {
  redacted: Record<string, string>
  redactedKeys: string[]
  warnings: string[]
}

export function redactEnv(env: Record<string, string>, config: RedactConfig): RedactResult {
  const allKeys = [...CURATED_KEYS, ...config.redactEnvKeys]
  const redacted: Record<string, string> = {}
  const redactedKeys: string[] = []
  const warnings: string[] = []

  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase()
    const isSensitive = allKeys.some((k) => upper.includes(k.toUpperCase()))

    if (isSensitive) {
      redacted[key] = '<redacted>'
      redactedKeys.push(key)
    } else {
      redacted[key] = value
      if (value.length > LONG_VALUE_THRESHOLD) {
        warnings.push(
          `${key}: long value (${value.length} chars), not in curated/configured list; may contain a credential. shell-cassette matches by key name only, not value pattern. Review cassette, or add ${key} to config.redactEnvKeys.`,
        )
      }
    }
  }

  return { redacted, redactedKeys, warnings }
}
