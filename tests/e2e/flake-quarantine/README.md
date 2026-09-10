# Flake-Quarantine Convention

> **Status: dormant.** The directory is currently empty — no tests are in
> quarantine. This page documents the convention for when the next flaky test
> needs one; do not delete it.

Tests moved here are **known to be flaky** — they fail intermittently due to
timing, rendering race conditions, or browser-specific behavior. They are
excluded from the default `playwright test` run (nothing under this directory
is referenced by `playwright.config.ts`; while the directory is empty that
exclusion is vacuous — it takes effect again the moment a spec is added).

## Rules

1. **Move, don't delete.** A flaky test stays in the repo so someone can
   debug it. Only delete if the feature or assertion is permanently removed.
2. **Document the flake.** Each file must have a top-level comment explaining
   what flakes and why.
3. **Fix window.** A test must not stay in quarantine for more than 2
   sprints. Either fix it or replace it with a more stable assertion.
4. **No CI coverage.** Quarantined tests are not run in CI.

## Running quarantined tests

```bash
npx playwright test tests/e2e/flake-quarantine --project=chromium --reporter=list
```

(While the directory is empty this command fails with "no tests found" — that
is expected until the first spec is quarantined.)

## What to quarantine

- Tests that depend on exact paint timing (requestAnimationFrame races)
- Tests that fail in headed vs headless mode
- Tests with non-deterministic outcomes (e.g. font loading, image decode)
- Tests that fail only in WebKit or Firefox due to engine-specific behavior
