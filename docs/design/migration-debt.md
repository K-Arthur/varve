# Migration Debt — design system adoption tracker

**Last updated:** 2026-07-27
**See:** ADR-0011 (governance), `docs/design/component-status.md`

Tracks surfaces not yet migrated to canonical `@strata/ui` primitives and tokens.
Each entry has: current state, target state, blocker, and status.

---

## Token usage debt

### Compatibility aliases (canonical name missing → alias emitted)

| Alias | Canonical | Consumers | Status |
|---|---|---|---|
| `--color-surface-default` | `--color-surface-base` | 39 (editor CSS) | Alias added 2026-07-27; migrate incrementally |
| `--color-on-accent` | `--color-text-on-accent` | 5 (editor CSS) | Alias added 2026-07-27; migrate incrementally |
| `--color-accent-hover` | `--color-interactive-hover` | 1 (website CSS) | Alias added 2026-07-27; migrate incrementally |

### Missing tokens (now defined — no remaining blockers)

| Token | Status |
|---|---|
| `--z-modal` | Added 2026-07-27 |
| `--elevation-scrim` | Added 2026-07-27 (per-theme) |
| `--color-on-warning` | Added as `--color-text-on-warning` 2026-07-27 |

---

## Component migration debt

### Editor surfaces using inline implementations

| Surface | Current | Target | Status |
|---|---|---|---|
| Inspector fields | Mixed inline + NumberInput | Canonical Input, Select, Slider, Switch | Partially migrated |
| Font browser | Inline select-like | Combobox | Not started |
| Batch rename dialog | Inline | Dialog + Input | Not started |
| Timeline track headers | Inline | Tabs + Toolbar | Not started |
| Settings dialog | Dialog + Select + NumberInput | Canonical (mostly done) | Mostly migrated |
| Export dialog | Dialog + Select + Slider | Canonical (mostly done) | Mostly migrated |
| Layers panel | Inline tree | Tree primitive | Not started (Tree not built) |

### Hardcoded values remaining (known)

| File | Issue | Status |
|---|---|---|
| `StartupLoader.css` | `#10151f`, `#ffffff` hardcoded | Intentional (splash screen); document exception |
| `components.css` | 18px checkbox, 14px slider thumb, 1000px max-height | Optical corrections; document exception |
| `Panel.tsx` | `defaultWidth = 260`, `minWidth = 180` | Not grid-aligned; migrate to `--space-*` scale |
| `inspector.css` | `z-index: 99, 100, 1000` raw numbers | Migrate to `--z-*` tokens |
| Various editor CSS | Raw z-index 40, 45 | Migrate to `--z-*` tokens |

---

## Storybook coverage gaps

Components missing stories (20 of 30):

Checkbox, IconButton, Menu, Slider, Tabs, NumberInput, SearchField,
SegmentedControl, ViewModeSwitcher, ContentSkeleton, CopyButton,
DeterminateProgress, InlineActivityIndicator, RegionLoader, StartupLoader,
Toolbar, FocusTrap, FloatingPortal, AlertDialog (shares Dialog stories).

---

## Priority migration order

1. ~~Token gap closure~~ ✅ Done 2026-07-27
2. Storybook coverage for stable components
3. Inspector field canonicalization (Input, Radio, Switch extraction)
4. Z-index consolidation (raw numbers → tokens)
5. Inline component extraction (Font browser, Batch rename, Timeline)
6. Tree/VirtualList for Layers panel
7. Hardcoded value cleanup (optical corrections documented or migrated)

---

## How to update this doc

When you migrate a surface:
1. Move it from "not started" / "partially migrated" to a "✅ Migrated YYYY-MM-DD" section.
2. Note any exceptions (intentional deviations from the standard).
3. Run `pnpm audit:tokens` and `pnpm typecheck` to verify no regressions.
