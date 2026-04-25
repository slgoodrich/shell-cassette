// CI=true is set by GitHub Actions and forces replay-strict mode in resolveMode.
// Integration tests construct sessions and exercise the full mode-resolution path; they need
// the default 'auto' scope to apply. Unit tests for resolveMode pass isCI explicitly so they
// don't depend on this.
delete process.env.CI
