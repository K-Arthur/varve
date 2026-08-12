# UI/UX Neo-Bento Redesign — Session Memory

**Started:** 2026-07-08  
**Target:** Neo-Bento grid + Linear-esque precision (dark/light)  
**Branch:** master  
**Status:** Complete

## Cascade Review Status

| Pass | Status | Notes |
|------|--------|-------|
| P1 Independent review | Done | Design + A11Y sub-agents |
| P2 Cross-challenge | Done | gpu-layer vs portal conflict resolved → portal + remove shell gpu-layer |
| P3 Conflict resolution | Done | Prioritize P0 clipping before aesthetic P1 |
| P4 TDD + headless | Done | Select/Menu portal tests added |
| P5 Full gate | Done | format-check + lint + test + token/emoji audits |

## P0 Findings (all fixed)

1. **Menubar dropdown clipping** — portaled via `FloatingPortal`
2. **gpu-layer breaks fixed overlays** — moved to canvas only
3. **ShortcutPalette inline + hardcoded rgba** — tokenized CSS + portal
4. **Menu/Select absolute in overflow panels** — portaled via `FloatingPortal`

## P1 Findings (all fixed)

- Dual surface systems → `--color-surface-*` aliases `--elevation-surface-*`
- `.file-card` overrides `.bento-cell` → layout-only, bento chrome
- GradientEditor unstyled inline → `inspector.css` classes
- HC theme missing elevation overrides → `HC_ELEVATION` in token generator
- BindingMenu fixed positioning → portaled combobox

## Implementation Log

| Item | Commit |
|------|--------|
| FloatingPortal + ShortcutPalette.css + memory doc | 802d717 |
| Menubar portal, gpu-layer, token z-index/scrim | 37e59e4 |
| Select/Menu portals + home bento file-card | 1997a32 |
| Surface tokens, BindingMenu portal, GradientEditor CSS | d7696b4 |
| Menubar zoom CSS cleanup + memory finalization | 80cea61 |

## Verification Gates

- [x] FloatingPortal + Menubar tests
- [x] Select/Menu/FloatingPortal tests (45/45)
- [x] `pnpm audit:tokens` (96/96 WCAG-AA)
- [x] `pnpm audit:emoji` (990 files clean)
- [x] `just format-check` (1045 files)
- [x] UI-scope lint clean (13 touched files, 0 errors)
- [ ] `just gate` full — blocked by 7 pre-existing lint errors elsewhere (tailwind at-rules, unused imports in WIP)

## Architecture Established

- All dropdowns/overlays use **`FloatingPortal` → `document.body`** with `position: fixed` + Floating UI
- **`gpu-layer` only on canvas**, not editor shell
- Use **`--elevation-*`**, **`--border-micro`**, **`--z-overlay`** tokens — no hardcoded rgba/z-index 9999
- **`--color-surface-*`** are aliases to **`--elevation-surface-*`** (single elevation system)
