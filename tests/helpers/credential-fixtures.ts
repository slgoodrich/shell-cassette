/**
 * Vetted sample credentials for each bundled redaction rule.
 * Source of truth: tests/unit/redact-patterns.test.ts per-rule regression fixtures.
 *
 * Use these constants in integration, unit, cli, and property tests instead of
 * scattering bare credential strings throughout the test suite. When a bundled
 * rule's pattern changes, only this file (and redact-patterns.test.ts) need
 * updating.
 */

/** Sample matching github-pat-classic. Vetted in M2. */
export const SAMPLE_GITHUB_PAT_CLASSIC = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'

/** Alternate sample matching github-pat-classic (used where two distinct PATs are needed). */
export const SAMPLE_GITHUB_PAT_CLASSIC_2 = 'ghp_ZYXwvuTSRqponMLKjihgfeDCBA0987654321'

/** Sample matching github-pat-fine-grained. */
export const SAMPLE_GITHUB_PAT_FINE_GRAINED = `github_pat_${'A'.repeat(82)}`

/** Sample matching github-oauth. */
export const SAMPLE_GITHUB_OAUTH = `gho_${'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'}`

/** Sample matching github-user-to-server. */
export const SAMPLE_GITHUB_USER_TO_SERVER = `ghu_${'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'}`

/** Sample matching github-server-to-server. */
export const SAMPLE_GITHUB_SERVER_TO_SERVER = `ghs_${'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'}`

/** Sample matching github-refresh. */
export const SAMPLE_GITHUB_REFRESH = `ghr_${'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'}`

/** Sample matching aws-access-key-id. */
export const SAMPLE_AWS_ACCESS_KEY_ID = 'AKIA0123456789ABCDEF'

/** Sample matching stripe-secret-live. */
export const SAMPLE_STRIPE_SECRET_LIVE = `sk_live_${'a'.repeat(24)}`

/** Sample matching stripe-secret-test. */
export const SAMPLE_STRIPE_SECRET_TEST = `sk_test_${'a'.repeat(24)}`

/** Sample matching stripe-restricted-live. */
export const SAMPLE_STRIPE_RESTRICTED_LIVE = `rk_live_${'a'.repeat(24)}`

/** Sample matching stripe-restricted-test. */
export const SAMPLE_STRIPE_RESTRICTED_TEST = `rk_test_${'a'.repeat(24)}`

/** Sample matching anthropic-api-key. */
export const SAMPLE_ANTHROPIC_API_KEY = `sk-ant-api03-${'a'.repeat(80)}`

/** Sample matching openai-api-key (bare sk- prefix). */
export const SAMPLE_OPENAI_API_KEY = `sk-${'a'.repeat(48)}`

/** Sample matching openai-api-key with sk-proj- prefix. */
export const SAMPLE_OPENAI_API_KEY_PROJ = `sk-proj-${'a'.repeat(48)}`

/** Sample matching google-api-key. */
export const SAMPLE_GOOGLE_API_KEY = `AIza${'a'.repeat(35)}`

/** Sample matching slack-token (xoxb- prefix). */
export const SAMPLE_SLACK_TOKEN = 'xoxb-1234567890'

/** Sample matching slack-webhook-url. */
export const SAMPLE_SLACK_WEBHOOK_URL =
  'https://hooks.slack.com/services/T0AB12CDE/B0FG34HIJ/0123456789ABCDEF'

/** Sample matching gitlab-pat. */
export const SAMPLE_GITLAB_PAT = `glpat-${'a'.repeat(20)}`

/** Sample matching npm-token. */
export const SAMPLE_NPM_TOKEN = `npm_${'a'.repeat(36)}`

/** Sample matching digitalocean-pat. */
export const SAMPLE_DIGITALOCEAN_PAT = `dop_v1_${'0'.repeat(64)}`

/** Sample matching sendgrid-api-key. */
export const SAMPLE_SENDGRID_API_KEY = `SG.${'a'.repeat(22)}.${'a'.repeat(43)}`

/** Sample matching mailgun-api-key. */
export const SAMPLE_MAILGUN_API_KEY = `key-${'0'.repeat(32)}`

/** Sample matching huggingface-token. */
export const SAMPLE_HUGGINGFACE_TOKEN = `hf_${'a'.repeat(34)}`

/** Sample matching pypi-token. */
export const SAMPLE_PYPI_TOKEN = `pypi-AgE${'a'.repeat(50)}`

/** Sample matching discord-bot-token. */
export const SAMPLE_DISCORD_BOT_TOKEN = `M${'a'.repeat(23)}.${'a'.repeat(6)}.${'a'.repeat(27)}`

/** Sample matching square-production-token. */
export const SAMPLE_SQUARE_PRODUCTION_TOKEN = `EAAA${'a'.repeat(60)}`
