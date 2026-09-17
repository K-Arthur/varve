# Interface density — implementation evidence (2026-09-17)

**Status:** implemented, validated in the running app, committed on `master`.
**Research ledger:**
[`../research/interface-density-2026-09-17.md`](../research/interface-density-2026-09-17.md)
**Ownership:**
[`../agents/interface-density-2026-09-17-ownership.md`](../agents/interface-density-2026-09-17-ownership.md)
**Base HEAD:** `cd788635b` (validation later re-run at the commit SHA noted
below; the shared tree gained two unrelated commits from concurrent sessions
during validation, and owned-scope checks were re-run after those landed).

## What shipped

1. **`settings.appearance.uiDensity`** — `'default' | 'compact'`, persisted
   in `varve-editor-settings`, sanitized on load (unknown values normalize to
   `'default'`), migrated through the legacy UI-settings path with the same
   check. `fontSizeUI` gets the same normalization it previously lacked.
2. **`packages/editor/src/settings/interfaceDensity.ts`** — the single
   writer for the root interface contract: `data-density` attribute
   (mapped to the shared `comfortable`/`compact` CSS values), root
   `font-size` override for UI font size, change notification for virtualizer
   consumers, and an observable `appliedRowHeight()` for estimate baselines.
3. **Settings ▸ Appearance** — "Interface density" select (Default Pro /
   Compact Pro) with a hint naming the active row contract; the previously
   dead "UI font size" control is now live through the same application
   effect in `SettingsProvider` (mount, change, and reset all route through
   it).
4. **Pre-paint application** — `apps/desktop/index.html` applies the
   persisted density and font size before first paint (same no-flash
   contract as the theme script), so compact users do not see a default-mode
   flash on boot.
5. **Density-aware virtualization** — `LayersTree` uses the mode's
   row-height contract for `estimateSize` (compact 28 / default 34; the
   previous hardcoded `28` disagreed with the real comfortable row) and
   re-measures on density change, so scroll anchoring and the spacer height
   are correct immediately after a switch; `measureElement` remains the
   authoritative per-row measurement.

## Deliberate non-goals (recorded decisions)

- **No third mode exposed.** The `cozy` block stays for website/card
  surfaces; the editor offers exactly Default Pro and Compact Pro.
- **No manual touch override.** Coarse-pointer promotion to 44px targets
  stays media-query-derived; a manual toggle would rescale the UI whenever a
  hybrid device's primary pointer changes (the failure mode the workstream
  explicitly forbids).
- **No per-workspace density.** Density is an application preference, like
  theme — one resolver, one writer, no second source of truth.

## Visual evidence (all inspected directly)

`docs/screenshots/2026-09-17-interface-density/`:

| File | Shows |
| --- | --- |
| `baseline-editor-default.png` | Baseline: no `data-density` anywhere; comfortable contract silently applied |
| `baseline-settings-appearance.png` | Baseline Appearance section: "UI font size" present but wired to nothing; no density control |
| `default-light.png` / `compact-light.png` | Same document/selection at 1440×900 light: 4 rows visible → 5 rows; selection retained; toggles and text scale unchanged |
| `default-dark.png` / `compact-dark.png` | Same comparison in Dark |
| `settings-compact-light.png` | The new control showing Compact Pro with its contract hint |

Measured pairs (real Chromium, port 1520):

| Probe | Default Pro | Compact Pro |
| --- | --- | --- |
| `html[data-density]` | `comfortable` | `compact` |
| Row `min-height` | 34px | 28px |
| Rendered row height | 37.8px | 31.9px |
| Rows visible in the 160px tree floor | 4 | 5 (+25%) |
| Row font size / toggles | 14.72px / 24px targets | identical (unchanged) |

## Validation actually run

| Check | Result |
| --- | --- |
| `packages/editor/src/settings/interfaceDensity.test.ts` (new) | 15/15 |
| `packages/editor/src/settings.test.ts` (normalization additions) | all pass (40 incl. 2 new) |
| `packages/editor/src/components/Settings/SettingsDialog.test.tsx` (2 new cases) | 21/21 |
| `packages/editor/src/components/LayersPanel` directory | 353/353 |
| `tests/e2e/settings/density.spec.ts` (new, real Chromium, isolated port 1531, `--workers=1`) | 5/5 |
| `pnpm verify:plan` at base HEAD | escalated (144 dirty files from other sessions) — recorded; owned-scope closure used instead |
| `pnpm typecheck` for `@varve/editor` | no errors in owned files (pre-existing errors in other writers' in-flight files unchanged) |
| `pnpm audit:docs`, `audit:emoji`, `audit:tokens` | see command log below |

### E2E scenario coverage (prompt §9 mapping)

| Required scenario | Covered by |
| --- | --- |
| "Change density during layer navigation" | spec 2: 10-row tree, mid-list selection, scrolled tree, switch → selection retained, 28px rows, spacer shrink |
| "Save, reopen… UI-only preferences remain separate" | spec 1 (no dirty/no undo entry) + spec 3 (persist + pre-paint) + spec 5 (reset restores defaults) |
| Corrupt/legacy persisted preferences | spec 4 (unknown `uiDensity`/`fontSizeUI` normalize) |
| Keyboard/pointer routes | Settings control is the shared `Select` (keyboard operable); Undo inactivity asserted after switch |

### Honest gaps / unverified lanes

- **Physical touch, pen, and screen-reader validation did not run** (no
  hardware/AT in this environment). The coarse-pointer promotion is existing
  CSS verified by inspection of the media rules, not a device run.
- WebKitGTK desktop build was not driven for this change; the E2E lane is
  Chromium. Firefox/WebKit project runs are deferred to the integration
  checkpoint (per the affected plan, which is already escalated by the
  shared tree).
- Performance: the density switch is a CSS attribute flip plus one virtualizer
  re-measure of mounted rows; no timing regression is plausible and none was
  measured beyond the E2E runs' latency. No claims made.
- `fontSizeUI`'s "Small" tier (15px root) reduces interface text slightly
  below the browser default; it is an existing choice made live, not a new
  recommendation. The type floor work in the Inspector (12px labels etc.)
  was reviewed by the concurrent Inspector passes and is untouched here.

## Agent Validation Report

```text
Changed scope: packages/editor/src/settings.ts (+interfaceDensity.ts +test),
  SettingsContext.tsx, SettingsDialog.tsx (+test), LayersTree.tsx,
  apps/desktop/index.html, tests/e2e/settings/density.spec.ts (new),
  docs (interface-sizing-system.md, spacing-system.md, research/audit/
  ownership records, screenshots).
Validation plan: pnpm verify:plan at base HEAD — FULL-SUITE ESCALATION: YES
  (shared tree carries other sessions' toolchain-adjacent dirty files);
  bounded owned-scope closure used for the inner loop.
Commands actually run: pnpm verify:plan; vitest (settings + SettingsDialog +
  LayersPanel directory); playwright density.spec.ts (isolated port 1531,
  chromium, workers=1); pnpm audit:docs; pnpm audit:emoji; pnpm audit:tokens;
  pnpm --filter @varve/editor typecheck.
Passed: all of the above (exact counts in the tables above).
Skipped as unrelated: the other sessions' dirty closure (font pipeline,
  generative editing, Tauri build files, website docs) — not this change set.
Escalations: full gate deferred to the combined integration checkpoint
  (reason: concurrent uncommitted workspace changes by other sessions).
Full suite run: no.
```
