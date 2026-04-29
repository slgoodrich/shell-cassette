# Bundled redaction patterns

shell-cassette provides 25 default-on credential patterns. Each pattern is anchored, character-class-locked, and length-bounded by the issuer's published format.

For ambiguous credential shapes (AWS Secret Access Keys, JWTs, generic 32-hex tokens), the bundle deliberately does not include a pattern. The long-value warning catches them at length 40+ when they don't look like a path. Custom rules cover the rest.

## Pattern table

| Rule name | Provider | Prefix | Length | Doc |
|---|---|---|---|---|
| `github-pat-classic` | GitHub | `ghp_` | 36 char body | https://github.blog/2021-04-05-behind-githubs-new-authentication-token-formats/ |
| `github-pat-fine-grained` | GitHub | `github_pat_` | 82 char body | (same) |
| `github-oauth` | GitHub | `gho_` | 36 | (same) |
| `github-user-to-server` | GitHub | `ghu_` | 36 | (same) |
| `github-server-to-server` | GitHub | `ghs_` | 36 | (same) |
| `github-refresh` | GitHub | `ghr_` | 36 | (same) |
| `aws-access-key-id` | AWS | `AKIA` / `ASIA` / `AROA` / `AIDA` / `AGPA` / `ANPA` / `ANVA` / `APKA` / `ABIA` / `ACCA` | 16 char body | https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html |
| `stripe-secret-live` | Stripe | `sk_live_` | 24+ | https://stripe.com/docs/keys |
| `stripe-secret-test` | Stripe | `sk_test_` | 24+ | (same) |
| `stripe-restricted-live` | Stripe | `rk_live_` | 24+ | (same) |
| `stripe-restricted-test` | Stripe | `rk_test_` | 24+ | (same) |
| `anthropic-api-key` | Anthropic | `sk-ant-(api03\|sid01\|admin01)-` | 80+ | https://docs.anthropic.com/en/api/getting-started |
| `openai-api-key` | OpenAI | `sk-` (also `sk-proj-`, `sk-svcacct-`, `sk-admin-`) | 40+ | https://platform.openai.com/docs/api-reference/authentication |
| `google-api-key` | Google | `AIza` | 35 | https://cloud.google.com/api-keys/docs/overview |
| `slack-token` | Slack | `xox[baprso]-` | 10+ | https://api.slack.com/authentication/token-types |
| `slack-webhook-url` | Slack | `https://hooks.slack.com/services/T*/B*/*` | structured | (same) |
| `gitlab-pat` | GitLab | `glpat-` | 20 | https://docs.gitlab.com/ee/security/token_overview.html |
| `npm-token` | npm | `npm_` | 36 | https://docs.npmjs.com/about-access-tokens |
| `digitalocean-pat` | DigitalOcean | `dop_v1_` | 64 hex | https://docs.digitalocean.com/reference/api/create-personal-access-token/ |
| `sendgrid-api-key` | SendGrid | `SG.` | 22 + `.` + 43 | https://docs.sendgrid.com/api-reference/api-keys/create-api-keys |
| `mailgun-api-key` | Mailgun | `key-` | 32 hex | https://documentation.mailgun.com/en/latest/api-intro.html#authentication |
| `huggingface-token` | Hugging Face | `hf_` | 34 | https://huggingface.co/docs/hub/security-tokens |
| `pypi-token` | PyPI | `pypi-AgE` | 50+ | https://pypi.org/help/#apitoken |
| `discord-bot-token` | Discord | `[MN]` | 23 + `.` + 6 + `.` + 27+ | https://discord.com/developers/docs/reference#authentication |
| `square-production-token` | Square | `EAAA` | 60+ | https://developer.squareup.com/docs/build-basics/access-tokens |

Patterns apply to env values, args, stdout lines, stderr lines, and `allLines`. The same pattern is shared across all five sources; the placeholder records which source it fired in: `<redacted:source:rule-name:N>`.

## Adding a custom rule

If your project uses a credential format not in the bundle, add a custom rule:

```ts
// shell-cassette.config.mjs
export default {
  redact: {
    customPatterns: [
      {
        name: 'my-internal-token',
        pattern: /MYINT-[A-Z0-9]{32}/,
        description: 'Internal company API token',
      },
    ],
  },
}
```

Notes:

- The `g` flag is normalized internally; supplying a regex with or without `g` works the same.
- `name` must be lowercase kebab-case (`/^[a-z][a-z0-9-]*$/`). It appears in placeholder strings: `<redacted:source:my-internal-token:N>`.
- `pattern` may also be a function `(s: string) => string` for advanced cases (e.g., conditional replacement). Function-typed patterns can NOT be position-scanned by `shell-cassette scan`; prefer regex when possible.
- Custom rules apply to the same five sources as bundled rules.

## Suppressing false positives

If a bundled pattern triggers on a value you know is not a credential (a fake-looking test fixture, a deterministic UUID, etc.), add it to `suppressPatterns`. Suppress patterns are checked FIRST, before bundle and custom rules:

```ts
// shell-cassette.config.mjs
export default {
  redact: {
    suppressPatterns: [
      /^FAKE_/,                 // values starting with FAKE_ are exempt from all rules
      /AKIA0000000000000000/,   // a specific test fixture token
    ],
  },
}
```

A suppressed value is also exempt from the long-value warning.

## Disabling the bundle

To opt out of bundled detection entirely (custom rules and suppress list still apply):

```ts
export default {
  redact: {
    bundledPatterns: false,
    customPatterns: [/* your own */],
  },
}
```

This is rarely the right answer. If a single bundled rule misfires, suppress that specific value. Disabling the bundle removes coverage for every other provider.

## Long-value warnings (length-based, not pattern-based)

Values 40+ characters long that did NOT match any rule emit a warning at record time. The warning is logged but the value is NOT redacted; shell-cassette can't pattern-match an unknown shape safely.

The threshold (default 40) and a path heuristic (skip warning when value contains `/`, `\`, `:`, or whitespace) are tunable in config:

```ts
export default {
  redact: {
    warnLengthThreshold: 40,    // default
    warnPathHeuristic: true,    // default
    suppressLengthWarningKeys: ['MY_LONG_BENIGN_VAR'],   // additive to curated default
  },
}
```

The 40-char threshold catches GitHub PATs, OpenAI keys, Stripe restricted, AWS Secret Access Keys without nagging on common path-shaped env vars. Tune lower (e.g., 24) if your workload has shorter unknown-shape secrets; tune higher if you see noise.

The pipeline also strips ANSI escape sequences before measuring length, so a colored 30-char banner (raw bytes ~50 chars due to ANSI codes) does not trigger the warning. Stripping is internal to the heuristic; the recorded value keeps its original bytes.

A curated default list of env-var keys (case-insensitive substring match) skip the length warning entirely:

| Key prefix | Reason |
|---|---|
| `PATHEXT` | Windows path-extension list (`.COM;.EXE;.BAT;...`), 30-70 chars typical. |
| `WSLENV` | WSL forwarded-env list, often long without path-heuristic chars. |
| `__INTELLIJ_COMMAND_HISTFILE__` | IDE pollution; ~70 chars. |
| `PSMODULEPATH` | PowerShell module search path on Windows. |
| `SHELL_SESSION_HISTFILE` | Shell session history file path. |

`suppressLengthWarningKeys` extends this list. Substring match: `MY_PROJECT` matches `MY_PROJECT_TOKEN_LIST`, `MY_PROJECT_BACKUP`, etc.

## See also

- [README](../README.md) for the redaction credibility section, ack-gate behavior, and pre-commit hook recipe.
- [troubleshooting.md](troubleshooting.md) for residual risks, scan/re-redact workflows, and when to use `useCassette({ redact: false })`.
