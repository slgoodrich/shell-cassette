/**
 * Curated env-key substring list. Case-insensitive. Inherited from v0.2/v0.3
 * behavior for backward compatibility.
 *
 * v0.4 keeps the curated list and lets users extend via Config.redact.envKeys
 * (substring match, also case-insensitive). The substring match is intentionally
 * loose: GITHUB_TOKEN, MY_TOKEN_VAR, and TOKENIZER_PATH all match TOKEN. The
 * cosmetic-vs-catastrophic tradeoff (false-positive redaction is annoying;
 * missed credential is dangerous) favors keeping the loose match. False
 * positives can be suppressed via Config.redact.suppressPatterns.
 */
export const CURATED_ENV_KEYS = [
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
