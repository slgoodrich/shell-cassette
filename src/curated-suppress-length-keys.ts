/**
 * Env-var keys whose values commonly exceed the length-warning threshold
 * without containing credentials. The redact pipeline skips the
 * "long unredacted value" warning when an env-var's key matches any of
 * these via case-insensitive substring.
 *
 * Matching is intentionally loose (substring): WSLENV matches WSLENV_BACKUP,
 * PSMODULEPATH matches PSModulePath_OLD, etc. The same loose semantics that
 * govern the curated env-key redaction list.
 *
 * Users extend the list via `Config.redact.suppressLengthWarningKeys`.
 */
export const DEFAULT_SUPPRESS_LENGTH_KEYS: readonly string[] = Object.freeze([
  // Windows path-extension list (.COM;.EXE;.BAT;.CMD;...) typically 30-70 chars.
  'PATHEXT',
  // WSL forwarded-env list, often long without path-heuristic chars.
  'WSLENV',
  // IDE pollution; common ~70 chars.
  '__INTELLIJ_COMMAND_HISTFILE__',
  // PowerShell module search path; long on Windows dev machines.
  'PSMODULEPATH',
  // Shell session HISTFILE; tools sometimes set long values.
  'SHELL_SESSION_HISTFILE',
])
