import type { RedactRule } from './types.js'

/**
 * Bundled credential patterns shipped by shell-cassette as default-on detection.
 *
 * Reliability bar: every pattern in this file is anchored, character-class-locked,
 * and length-bounded by the issuer's published documentation. Ambiguous shapes
 * (AWS Secret Access Keys, JWTs, generic 32-hex tokens, Heroku/Datadog/Twilio
 * tokens) are deliberately NOT in the bundle; the long-value warning and
 * user-supplied custom rules cover those.
 *
 * Patterns are stored without the `g` flag so the underlying RegExp objects
 * are stateless and safe to use directly with `.test()` or `.exec()`. The
 * redaction pipeline adds the `g` flag internally when iterating matches.
 *
 * See `RedactRule` in `./types.js` for the rule-name API stability contract.
 */

export const BUNDLED_PATTERNS: readonly RedactRule[] = [
  // GitHub family
  // https://github.blog/2021-04-05-behind-githubs-new-authentication-token-formats/
  {
    name: 'github-pat-classic',
    pattern: /ghp_[A-Za-z0-9]{36}/,
    description: 'GitHub personal access token (classic)',
  },
  {
    name: 'github-pat-fine-grained',
    pattern: /github_pat_[A-Za-z0-9_]{82}/,
    description: 'GitHub fine-grained personal access token',
  },
  {
    name: 'github-oauth',
    pattern: /gho_[A-Za-z0-9]{36}/,
    description: 'GitHub OAuth access token',
  },
  {
    name: 'github-user-to-server',
    pattern: /ghu_[A-Za-z0-9]{36}/,
    description: 'GitHub user-to-server token',
  },
  {
    name: 'github-server-to-server',
    pattern: /ghs_[A-Za-z0-9]{36}/,
    description: 'GitHub server-to-server token',
  },
  {
    name: 'github-refresh',
    pattern: /ghr_[A-Za-z0-9]{36}/,
    description: 'GitHub refresh token',
  },

  // AWS Access Key ID family
  // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html
  {
    name: 'aws-access-key-id',
    pattern: /(AKIA|ASIA|AROA|AIDA|AGPA|ANPA|ANVA|APKA|ABIA|ACCA)[A-Z0-9]{16}/,
    description: 'AWS Access Key ID (all documented prefix variants)',
  },

  // Stripe
  // https://stripe.com/docs/keys
  {
    name: 'stripe-secret-live',
    pattern: /sk_live_[A-Za-z0-9]{24,}/,
    description:
      'Stripe live secret key. Also matches Clerk and other providers using the sk_live_ prefix shape; all such keys ARE secrets, so the redaction is correct even when the provider name is misleading.',
  },
  {
    name: 'stripe-secret-test',
    pattern: /sk_test_[A-Za-z0-9]{24,}/,
    description: 'Stripe test secret key (or any sk_test_ prefix variant)',
  },
  {
    name: 'stripe-restricted-live',
    pattern: /rk_live_[A-Za-z0-9]{24,}/,
    description: 'Stripe restricted live key',
  },
  {
    name: 'stripe-restricted-test',
    pattern: /rk_test_[A-Za-z0-9]{24,}/,
    description: 'Stripe restricted test key',
  },

  // Anthropic
  // https://docs.anthropic.com/en/api/getting-started
  // Note: Anthropic must precede OpenAI in this list. The OpenAI pattern's
  // bare sk- prefix would otherwise match Anthropic keys (sk-ant-...) first
  // and tag them as openai-api-key in placeholders.
  {
    name: 'anthropic-api-key',
    pattern: /sk-ant-(api03|sid01|admin01)-[A-Za-z0-9_-]{80,}/,
    description: 'Anthropic API key (api03, sid01, admin01 variants)',
  },

  // OpenAI
  // https://platform.openai.com/docs/api-reference/authentication
  {
    name: 'openai-api-key',
    pattern: /sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{40,}/,
    description: 'OpenAI API key (sk-, sk-proj-, sk-svcacct-, sk-admin- variants)',
  },

  // Google API
  // https://cloud.google.com/api-keys/docs/overview
  {
    name: 'google-api-key',
    pattern: /AIza[A-Za-z0-9_-]{35}/,
    description: 'Google API key',
  },

  // Slack
  // https://api.slack.com/authentication/token-types
  {
    name: 'slack-token',
    pattern: /xox[baprso]-[A-Za-z0-9-]{10,}/,
    description: 'Slack token (bot, app, user, refresh, OAuth: xox[baprso]- prefix family)',
  },
  {
    name: 'slack-webhook-url',
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
    description: 'Slack incoming webhook URL (path-bearer credential)',
  },

  // GitLab
  // https://docs.gitlab.com/ee/security/token_overview.html
  {
    name: 'gitlab-pat',
    pattern: /glpat-[A-Za-z0-9_-]{20}/,
    description: 'GitLab personal access token',
  },

  // npm
  // https://docs.npmjs.com/about-access-tokens
  {
    name: 'npm-token',
    pattern: /npm_[A-Za-z0-9]{36}/,
    description: 'npm publish token',
  },

  // DigitalOcean
  // https://docs.digitalocean.com/reference/api/create-personal-access-token/
  {
    name: 'digitalocean-pat',
    pattern: /dop_v1_[A-Fa-f0-9]{64}/,
    description: 'DigitalOcean personal access token v1',
  },

  // SendGrid
  // https://docs.sendgrid.com/api-reference/api-keys/create-api-keys
  {
    name: 'sendgrid-api-key',
    pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/,
    description: 'SendGrid API key',
  },

  // Mailgun
  // https://documentation.mailgun.com/en/latest/api-intro.html#authentication
  {
    name: 'mailgun-api-key',
    pattern: /key-[a-f0-9]{32}/,
    description: 'Mailgun API key',
  },

  // Hugging Face
  // https://huggingface.co/docs/hub/security-tokens
  {
    name: 'huggingface-token',
    pattern: /hf_[A-Za-z0-9]{34}/,
    description: 'Hugging Face access token',
  },

  // PyPI
  // https://pypi.org/help/#apitoken
  {
    name: 'pypi-token',
    pattern: /pypi-AgE[A-Za-z0-9_-]{50,}/,
    description: 'PyPI API token (pypi-AgE prefix is documented base64 header)',
  },

  // Discord
  // https://discord.com/developers/docs/reference#authentication
  {
    name: 'discord-bot-token',
    pattern: /[MN][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/,
    description: 'Discord bot token (M or N prefix, three-segment base64)',
  },

  // Square
  // https://developer.squareup.com/docs/build-basics/access-tokens
  {
    name: 'square-production-token',
    pattern: /EAAA[A-Za-z0-9_-]{60,}/,
    description: 'Square production access token',
  },
] as const
