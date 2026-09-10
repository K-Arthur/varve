# Recovery Dialog Remediation & UI Audit Fixes (2026-08-16)

- **Date**: 2026-08-16
- **Builds on**: `docs/audits/platform-ux-a11y-delta-2026-08-10.md` (all prior items closed)
- **Method**: Code review + implementation of remaining findings from the comprehensive UI/UX audit

## Findings implemented

### High severity

| # | Finding | Fix | Files |
|---|---------|-----|-------|
| H1 | RecoveryDialog renders completely unstyled (no CSS rules exist for `.recovery-dialog`) | Added comprehensive CSS to `editor.css` using design system tokens | `editor.css`, `RecoveryDialog.tsx` |
| H2 | RecoveryDialog `prevOpen` initialized to `open` prevents `showModal()` on first render | Replaced `prevOpen` ref with direct `el.open` check (matching `Dialog.tsx` pattern) | `RecoveryDialog.tsx` |
| H3 | Dialog close button touch target ~22-26px (below WCAG 2.5.5 minimum) | Set `min-width: 44px; min-height: 44px; display: inline-flex` on `.varve-dialog__close` | `components.css` |

### Medium severity

| # | Finding | Fix | Files |
|---|---------|-----|-------|
| M1 | ErrorBoundary buttons lack `:focus-visible` styles | Added `:focus-visible` rule with themed focus ring + secondary button variant | `editor.css` |
| M2 | ErrorBoundary does not auto-focus Reload button on error | Added `createRef` + `requestAnimationFrame` focus in `componentDidCatch` | `ErrorBoundary.tsx` |
| M3 | OfflineBanner dismiss button lacks `:focus-visible` | Added `:focus-visible` rule | `editor.css` |
| M4 | RecoveryDialog "Discard All" has no confirmation | Added two-click confirmation pattern with visual danger styling | `RecoveryDialog.tsx` |
| M6 | Select trigger missing `aria-disabled` | Added `aria-disabled={disabled \|\| undefined}` | `Select.tsx` |
| M8 | ExportDialog `safeFilename` strips all non-Latin characters | Changed regex to preserve Unicode; truncate to 200 chars | `ExportDialog.tsx` |

### Low severity

| # | Finding | Fix | Files |
|---|---------|-----|-------|
| L1 | AlertDialog `onConfirm` not wrapped in try/finally | Wrapped in try/finally calling `onClose()` in finally | `Dialog.tsx` |
| L2 | Input `aria-invalid` uses boolean `true` instead of string `'true'` | Changed to string form | `Input.tsx` |
| L5 | No toast deduplication for rapid repeated messages | Added 500ms debounce on identical messages | `ToastProvider.tsx` |
| L6 | EmptyStates.tsx unreachable `throw new Error()` branches | Removed dead code; changed fallback to `EMPTY_COPY.recent` | `EmptyStates.tsx` |
| L8 | No Escape-to-dismiss on Toast for keyboard users | Added `onKeyDown` handler for Escape key | `Toast.tsx` |

### Cleanup

| # | Finding | Fix | Files |
|---|---------|-----|-------|
| — | `CreateTableFromDataDialog.tsx` uses dead `varve-dialog-backdrop` class (no CSS rules exist) | Removed unused className | `CreateTableFromDataDialog.tsx` |

## Known architectural concern: global CSS loading

Many editor components define custom `className` strings but do **not** import their own CSS file. They work only because `editor.css` is imported globally at `apps/desktop/src/main.tsx`. This is documented here as a fragility concern:

**Risk**: If a new app entry point (e.g., a web editor, a test harness, a storybook) is created without importing `editor.css`, dozens of components will render completely unstyled.

**Affected component families** (non-exhaustive):
- `crash/crashDialogs.tsx` — CrashRecoveryDialog, CrashReviewDialog
- `crash/safeModeScreen.tsx` — SafeModeScreen
- `components/RecoveryDialog.tsx` — RecoveryDialog (now styled via `editor.css`)
- `components/OfflineBanner.tsx` — OfflineBanner
- `components/Onboarding/WelcomeDialog.tsx` — WelcomeDialog
- `components/Onboarding/SpotlightOverlay.tsx` — SpotlightOverlay
- `intelligence/ShortcutTipChip.tsx` — ShortcutTipChip
- `components/ZoomIndicator.tsx` — ZoomIndicator

**Contrast**: Components that properly import their own CSS (e.g., `BatchRenameDialog.tsx` → `BatchRename.css`, `ContentAwareFillDialog.tsx` → `ContentAwareFillDialog.css`) are self-contained and work in any entry point.

**Recommendation**: When a web entry point is created, audit all component CSS dependencies. Consider migrating high-priority components to import their own CSS or switching to CSS Modules.

## Typecheck / verification

- `pnpm --filter @varve/ui typecheck` — PASS
- `pnpm --filter @varve/home typecheck` — PASS
- `pnpm --filter @varve/editor typecheck` — PASS (pre-existing `canvasRectRef` errors in `inputPipeline.ts` unrelated to these changes)
- Full workspace `pnpm typecheck` — editor has 4 pre-existing errors in `inputPipeline.ts` + test file (not introduced by this batch)
