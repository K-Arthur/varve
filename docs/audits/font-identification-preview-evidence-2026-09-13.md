# Image font candidate specimen evidence — 2026-09-13

Font identification results now show a bounded specimen inside every candidate
card. The specimen uses the reviewed OCR/manual text when available, falls back
to the candidate's pipeline preview, and finally uses `Aa — 0123`. Installed
families are rendered with the candidate family and a conservative style
mapping; unavailable families keep a neutral browser fallback so the UI does
not imply that an uninstalled face was rendered.

The specimen is an image-like, labelled region for assistive technology and is
clipped to 96 characters so a long OCR result cannot widen the inspector. The
existing explicit actions remain separate: **Use for new text** and **Apply to
target** still create the same pending-format or one-step grouped edit.

## Validation

```text
./node_modules/.bin/vitest run packages/editor/src/components/Inspector/sections/FontDetectSection.test.tsx --config vitest.config.ts --reporter=verbose
pnpm exec biome check packages/editor/src/components/Inspector/sections/FontDetectSection.tsx packages/editor/src/components/Inspector/sections/FontDetectSection.test.tsx
```

Result: **7/7 unit tests passed** and the touched TypeScript files are
Biome-clean. The existing Chromium inspector readability spec was attempted at
port 1684 but the browser crashed during shared global setup while other
worktrees were running heavy E2E jobs; the prior inspector capture remains the
authoritative layout evidence. A result-state screenshot should be regenerated
when an isolated browser lane is available.
