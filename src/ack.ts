import { AckRequiredError } from './errors.js'

const HELP_TEXT = `refusing to record without redaction acknowledgment.

shell-cassette v0.1 redacts env var values when KEY matches:
  TOKEN, SECRET, PASSWORD, PASSWD, APIKEY, API_KEY, CREDENTIAL,
  PRIVATE_KEY, AUTH_TOKEN, BEARER_TOKEN, JWT
(extensible via shell-cassette.config.{js,mjs} \`redact.envKeys\`)

It does NOT redact:
  - stdout / stderr content
  - command args (e.g., --token=xyz)
  - env vars with non-curated names (e.g., STRIPE_KEY, OPENAI_KEY,
    DATABASE_URL) unless added via config
  - paths in cwd

ALWAYS review cassettes before committing.

To proceed: set SHELL_CASSETTE_ACK_REDACTION=true.`

export function requireAckGate(): void {
  if (process.env.SHELL_CASSETTE_ACK_REDACTION !== 'true') {
    throw new AckRequiredError(HELP_TEXT)
  }
}
