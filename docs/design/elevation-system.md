# Elevation System — Varve Design Tokens

## Model

Four hierarchical surface levels, all **100% opaque** (no glassmorphism, no backdrop-filter, no rgba surfaces):

| Level | z-index | Light | Dark | Use Cases |
|-------|---------|-------|------|-----------|
| **Sunken** | 0 | `oklch(0.95 0.008 260)` | `oklch(0.12 0.008 260)` | Canvas background, backdrops, wells |
| **Default** | 1 | `oklch(0.97 0.008 260)` | `oklch(0.18 0.008 260)` | Baseline flat UI, sidebar, panels |
| **Raised** | 100 | `oklch(0.99 0.006 260)` | `oklch(0.22 0.006 260)` | Cards, dialogs, menus, tooltips |
| **Overlay** | 1000 | `oklch(1 0 0)` | `oklch(0.27 0.005 260)` | Modals, floating toolbars, toasts, popovers |

## Dark Mode: Front-Lit Model

In dark mode, **higher surfaces are lighter** — the opposite of the physical world (where higher objects cast shadows). This front-lit model mimics a light source above the UI, making depth easier to perceive on dark backgrounds.

```
Light:   Sunken(dark) < Default < Raised < Overlay(light)
Dark:    Sunken(dark) < Default < Raised < Overlay(---brightest---)
```

## Shadows

Shadows are paired to elevation level and adapt to dark mode:

| Level | Light | Dark |
|-------|-------|------|
| Raised | `0 4px 12px oklch(0 0 0 / 0.14)` | `0 4px 12px oklch(0 0 0 / 0.30)` |
| Overlay | `0 12px 32px oklch(0 0 0 / 0.20)` | `0 12px 32px oklch(0 0 0 / 0.45)` |

Dark mode shadows are more opaque (30% vs 14%) to remain visible on near-black backgrounds.

## Micro-Borders

1px interior strokes provide secondary depth cues and state feedback:

| Token | Value |
|-------|-------|
| `--border-micro` | `1px solid oklch(0 0 0 / 0.08)` (dark: `oklch(1 1 1 / 0.08)`) |
| `--border-micro-accent` | `1px solid oklch(0.779 0.1229 188.31 / 0.25)` (dark: `/ 0.30`) |

## Per-Elevation Text Contrast

Text on each elevation has dedicated tokens guaranteeing WCAG 2.1 AA contrast:

| Token | Light L diff | Minimum Ratio |
|-------|-------------|---------------|
| `text-primary-on-default` | 0.97 − 0.1956 = 0.774 | ~17:1 |
| `text-secondary-on-default` | 0.97 − 0.3123 = 0.658 | ~12:1 |
| `text-primary-on-raised` | 0.99 − 0.1956 = 0.794 | ~18:1 |
| `text-primary-on-overlay` | 1.00 − 0.1956 = 0.804 | ~18:1 |

In dark mode, all per-elevation text tokens invert to light text on dark surfaces:

| Token | Dark L diff | Minimum Ratio |
|-------|-------------|---------------|
| `text-primary-on-default` | 0.9755 − 0.18 = 0.795 | ~17:1 |
| `text-primary-on-overlay` | 0.9755 − 0.27 = 0.705 | ~14:1 |

## CSS Variables

```css
/* Surface tokens */
--elevation-surface-sunken
--elevation-surface-default
--elevation-surface-raised
--elevation-surface-overlay

/* Interaction state tokens (hover variants) */
--elevation-surface-raised-hover
--elevation-surface-overlay-hover

/* Shadow tokens */
--elevation-shadow-raised
--elevation-shadow-overlay

/* z-index tokens */
--elevation-z-sunken    /* 0 */
--elevation-z-default   /* 1 */
--elevation-z-raised    /* 100 */
--elevation-z-overlay   /* 1000 */
```

## Usage Rules

1. **Always use elevation tokens** for surface backgrounds — never raw `--color-surface-*` or raw `oklch()` values
2. **Pair shadows with elevation** — a raised surface uses `--elevation-shadow-raised`
3. **Pair text with elevation** — text on a raised panel uses `--color-text-primary-on-raised` (or fall back to `--color-text-primary` with sufficient contrast)
4. **No alpha in surfaces** — the only allowed alpha is the modal scrim (`oklch(0 0 0 / 0.5)`)
5. **Front-lit dark mode** — in dark themes, `--elevation-surface-overlay` is lighter than `--elevation-surface-default`

## Contrast Audit

The token audit (`pnpm audit:tokens`) verifies 30 contrast pairs × 3 themes = 90 checks, including:
- All 6 per-elevation text tokens against their paired surface
- All 24 legacy surface/text/interactive/feedback/border/layer pairs
