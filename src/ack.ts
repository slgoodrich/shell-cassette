import { AckRequiredError } from './errors.js'

const HELP_TEXT = `shell-cassette is about to RECORD subprocess calls into a cassette file.

What gets redacted (default ON):
  * Curated env-key values (TOKEN, SECRET, PASSWORD, JWT, etc., case-insensitive substring)
  * User-extended env-key list (config.redact.envKeys)
  * 25 bundled credential patterns (GitHub, AWS access key ID, Stripe, OpenAI, Anthropic,
    Google API, Slack, GitLab, npm, DigitalOcean, SendGrid, Mailgun, Hugging Face, PyPI,
    Discord, Square) across env values, args, stdout, stderr, allLines
  * User-supplied custom rules (config.redact.customPatterns)

What does NOT get redacted (residual risk):
  * Credentials without a documented format (AWS Secret Access Keys, generic 32-hex tokens,
    Heroku/Datadog/Twilio tokens, internal/proprietary secrets); caught only by length warning
  * JWTs (many are non-secret public tokens; opt-in via custom rule if your JWTs are bearer-shaped)
  * Encoded credentials (Authorization: Basic base64, base64-encoded YAML/JSON secrets)
  * Binary output (BinaryOutputError prevents recording)
  * cwd values
  * Subprocess stdin (not captured until v0.5)

Verify before committing:  shell-cassette scan <path>
Migrate when bundle expands: shell-cassette re-redact <path>

Set SHELL_CASSETTE_ACK_REDACTION=true to acknowledge and proceed.`

export function requireAckGate(): void {
  if (process.env.SHELL_CASSETTE_ACK_REDACTION !== 'true') {
    throw new AckRequiredError(HELP_TEXT)
  }
}
