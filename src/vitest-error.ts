// Pure helpers for diagnosing vitest plugin registration failures. Kept
// in a separate module from src/vitest.ts so unit tests can import the
// helper without triggering the plugin's side-effects (TLA dynamic import
// of vitest, global beforeEach/afterEach registration).

import { VitestPluginRegistrationError } from './errors.js'

const VITEST_PLUGIN_REGISTRATION_HELP = `shell-cassette/vitest plugin failed to register hooks.

Most commonly this means vitest externalized shell-cassette without your config opting in.
Add this to your vitest config:
  // vitest 3.x
  test: { server: { deps: { inline: ["shell-cassette"] } } }
  // vitest 4.x
  test: { deps: { inline: ["shell-cassette"] } }

See https://github.com/slgoodrich/shell-cassette/blob/main/docs/troubleshooting.md`

// Wrap any error thrown during hook registration with deps.inline guidance.
//
// The most common failure here is vitest externalizing shell-cassette so the
// plugin module loads in a different module graph than vitest's runner. The
// observable symptom is a thrown Error mentioning "runner". We don't gate the
// wrap on the message text; registration at module top should never throw
// for any other reason, so any throw here gets the deps.inline diagnostic
// appended (with the original error preserved verbatim).
export function wrapRegistrationError(e: unknown): VitestPluginRegistrationError {
  const original = e instanceof Error ? e : new Error(String(e))
  return new VitestPluginRegistrationError(
    `${VITEST_PLUGIN_REGISTRATION_HELP}\n\nOriginal error: ${original.message}`,
  )
}
