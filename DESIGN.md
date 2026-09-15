---
name: Pro-Tool Precision Strata
themes:
  default: dark
  supported: [light, dark, high-contrast]
colors:
  primary: '#39D0C6'
  secondary: '#E28C3C'
  tertiary: '#C54B3A'
  surface-dark: '#0e131d'
  surface-light: '#f8f9fc'
typography:
  interface: Geist
  body: IBM Plex Sans
  editorial: Fraunces
  mono: SF Mono / Cascadia Code
rounded:
  control-compact: 6px
  control: 8px
  floating: 14px
  surface: 14px
  card: 18px
  device: 40px
  pill: 9999px
spacing:
  scale: 0-32 (fluid clamp values)
  baseline: 4px
  gutter: var(--space-5) = ~16px
  panel: var(--space-4) = ~12px
  toolbar: var(--space-2) = ~6px
layout:
  sidebar: fluid clamp(14rem, 12rem + 8vw, 18rem)
  inspector: fluid clamp(15rem, 13rem + 8vw, 20rem)
  menubar: var(--topbar-height) = ~36px
  floating-toolbar: var(--toolbar-height) = ~44px
  panel-header: var(--panel-header-height) = ~32px
---

## Brand & Style

The design system establishes a high-density, pro-tool precision environment engineered for vector manipulation, multi-layered canvas workflows, and interface construction. Built with native desktop ergonomics (GTK and Tauri caliber), it synthesizes clinical technical utility with the tactile depth of physical sedimentary strata.

### Visual Style & Aesthetic Philosophy
- **Dark Strata Architecture:** The visual space is layered in deep geological tiers, eschewing flat single-tone gray in favor of stepped tonal depth that provides physical separation between the boundless artwork abyss and dense floating chrome.
- **Surgical Precision:** Every control is calibrated for rapid manipulation—dense numeric property grids, scrubbable axis labels, and hairline 1px micro-borders that hold panel boundaries without visual bulk.
- **Focused Chromatic Hierarchy:** A luminous Teal primary accent (`#39D0C6` / `oklch(0.779 0.1229 188.31)`) acts as an active laser anchor for selections, transform bounds, active tools, and primary executions. Warm sandstone and terracotta accents serve as structural anchors for vector paths, geometry nodes, and layer state markers.
- **Restrained Glassmorphism:** Translucent floating toolbars and context flyouts leverage backdrop blur combined with dark neutral washes to allow work under the canvas to show through subtly without sacrificing legibility.

## Themes

The system ships three themes controlled by `[data-theme]` on the root element. When no explicit theme is set, `prefers-color-scheme: dark` and `prefers-contrast: more` provide automatic fallback.

### Dark (Default)

The primary workspace theme. Deep cosmic slate surfaces (`oklch(0.18 0.008 260)` at default elevation) with luminous teal accents. Highest information density; the environment designed for extended pro-tool sessions.

**Surface hierarchy (front-lit: higher elevation = brighter):**
| Token | Value | Use |
|-------|-------|-----|
| `surface-sunken` | `oklch(0.12 ...)` | Recessed wells, input troughs |
| `surface-app` / `surface-base` | `oklch(0.18 ...)` | App shell, panel backgrounds |
| `surface-raised` | `oklch(0.22 ...)` | Cards, floating panels |
| `surface-overlay` | `oklch(0.27 ...)` | Popovers, dropdowns, modals |

### Light

A high-legibility theme for bright environments. Pale cool-gray surfaces (`oklch(0.976 ...)` at default elevation) with deeper teal variants for sufficient contrast. Text inverts to dark neutrals; accent chroma is preserved but luminance-adjusted for WCAG AA on light backgrounds.

**Surface hierarchy (front-lit: higher elevation = brighter):**
| Token | Value | Use |
|-------|-------|-----|
| `surface-sunken` | `oklch(0.945 ...)` | Recessed wells |
| `surface-app` / `surface-base` | `oklch(0.976 ...)` | App shell |
| `surface-raised` | `oklch(1.0 ...)` | Cards, panels |
| `surface-overlay` | `oklch(1.0 ...)` | Popovers, modals |

**Key adaptations from dark:**
- Text tokens invert: `text-primary` goes from near-white to near-black.
- Interactive tokens shift from light-on-dark to dark-on-light (e.g. `interactive-default` uses a deeper teal step).
- Separators and borders use lighter neutral steps.
- Elevation is communicated by brightness increase (not shadow alone).

### High Contrast

Maximum-contrast mode for accessibility. Pure black surfaces (`oklch(0 0 0)`) with a vibrant yellow-green accent (`oklch(0.9519 0.2924 111.62)`) replacing teal. All borders become 2px solid white. Shadows are replaced by outline-style depth cues. Activated by `prefers-contrast: more` or explicit user selection.

**Design intent:**
- Every interactive element must be distinguishable at a glance.
- Color is supplemented by structural cues (thicker borders, outline shadows).
- The accent shifts from teal to yellow-green because green has the highest luminance at high chroma, maximizing visibility on pure black.
- Layer tags and feedback colors are preserved at full chroma for semantic meaning.

**Key adaptations:**
| Token | Dark value | HC value | Rationale |
|-------|-----------|----------|-----------|
| `accent-primary` | teal `oklch(0.779 ...)` | yellow-green `oklch(0.952 ...)` | Max luminance on black |
| `border-micro` | 1px `oklch(1 0 0 / 0.08)` | 2px solid white | Structural clarity |
| `elevation-shadow-raised` | 0 4px 12px black/0.3 | 0 0 0 2px white | Outline depth cue |
| `separator-subtle` | neutral step 10 | `oklch(0.55 0 0)` | Gray-on-black visibility |
| `text-on-accent` | near-black | pure black | Maximum contrast |

## Colors

The color palette uses OKLCH (Bjorn Ottosson, 2020) for perceptually uniform representation. All tokens are stored as `{ L, C, H }` objects in `color.ts`; the CSS generator emits `oklch(L C H)` values.

### Palette Architecture

**12-step ramps** (Radix-informed, index 1 = lightest, 12 = darkest):

| Ramp | Hue | Purpose |
|------|-----|---------|
| **NEUTRAL** | ~260 (cool gray) | Surfaces, text, borders, separators |
| **TEAL** | ~188 | Primary accent, interactive states, selections |
| **BLUE** | ~252 | Layer: Frames |
| **AMBER** | ~85 | Layer: Groups; search highlights |
| **GREEN** | ~150 | Layer: Text; feedback success |
| **VIOLET** | ~300 | Layer: Components |

**Brand accents** (fixed values, not ramps):
- **Sandstone** `ok(0.7161, 0.1398, 60.04)` — warm amber, vector handles, geometry nodes
- **Terracotta** `ok(0.5745, 0.1595, 30.53)` — deep red-orange, destructive barriers, mask frames

**Feedback hues** (single base per hue):
- **Success** `ok(0.6342, 0.1283, 156.2)` — green
- **Warning** `ok(0.6399, 0.1261, 79.82)` — amber
- **Danger** `ok(0.5763, 0.1773, 22.78)` — red
- **Info** `ok(0.6164, 0.132, 248.02)` — blue

### Semantic Color Tokens

Semantic tokens map to concrete OKLCH values per theme. CSS custom properties use the `--color-*` namespace.

**Surface tokens:**
| Token | Dark | Light | HC |
|-------|------|-------|-----|
| `surface-app` | `oklch(0.18 ...)` | `oklch(0.976 ...)` | `oklch(0 0 0)` |
| `surface-raised` | `oklch(0.22 ...)` | `oklch(1.0 ...)` | `oklch(0.097 0 0)` |
| `surface-sunken` | `oklch(0.12 ...)` | `oklch(0.945 ...)` | `oklch(0 0 0)` |
| `surface-overlay` | `oklch(0.27 ...)` | `oklch(1.0 ...)` | `oklch(0 0 0)` |
| `surface-hover` | `oklch(0.22 ...)` | `oklch(0.88 ...)` | `oklch(0.25 0 0)` |

**Text tokens:**
| Token | Dark | Light | HC |
|-------|------|-------|-----|
| `text-primary` | near-white | near-black | pure white |
| `text-secondary` | light gray | dark gray | `oklch(0.92 0 0)` |
| `text-subtle` | mid gray | `oklch(0.46 ...)` | `oklch(0.78 0 0)` |
| `text-muted` | mid gray | `oklch(0.43 ...)` | `oklch(0.858 0 0)` |
| `text-disabled` | dark gray | `oklch(0.58 ...)` | `oklch(0.461 0 0)` |
| `text-on-accent` | near-black | near-black | pure black |

**Interactive tokens:**
| Token | Dark | Light | HC |
|-------|------|-------|-----|
| `interactive-default` | teal step 5 | teal step 9 | yellow-green |
| `interactive-hover` | teal step 4 | teal step 10 | yellow-green |
| `interactive-active` | teal step 3 | teal step 11 | darker green |
| `interactive-selected-surface` | teal step 11 | teal step 2 | yellow-green fill |
| `interactive-selected-border` | teal step 5 | teal step 9 | yellow-green |
| `interactive-focus-ring` | teal step 5 | teal step 8 | yellow-green |
| `interactive-disabled` | neutral 10 | neutral 3 | `oklch(0.39 0 0)` |

**Border & separator tokens:**
| Token | Dark | Light | HC |
|-------|------|-------|-----|
| `border-subtle` | neutral 10 | neutral 4 | pure white |
| `border-strong` | neutral 7 | neutral 7 | pure white |
| `separator-subtle` | neutral 10 | neutral 4 | `oklch(0.55 0 0)` |
| `separator-default` | neutral 10 | neutral 4 | pure white |
| `border-focus` | teal step 5 | teal step 8 | yellow-green |

### Layer Semantics

Specialized tokens for the layer hierarchy panel. Each layer type has an accent (foreground icon tint) and a wash (background tint):

| Layer Type | Accent (Dark) | Wash (Dark) | Accent (Light) | Wash (Light) |
|------------|---------------|-------------|----------------|--------------|
| Frame | BLUE step 6 | BLUE step 11 | BLUE step 6 | BLUE step 1 |
| Group | AMBER step 3 | AMBER step 11 | AMBER step 8 | AMBER step 1 |
| Text | GREEN step 3 | GREEN step 11 | GREEN step 8 | GREEN step 1 |
| Shape | `ok(0.913 ...)` | `ok(0.285 ...)` | `ok(0.616 ...)` | `ok(0.965 ...)` |
| Component | VIOLET step 3 | VIOLET step 11 | VIOLET step 6 | VIOLET step 1 |
| Image | magenta | dark magenta | lighter magenta | pale magenta |
| Adjustment | orange | dark orange | lighter orange | pale orange |

**Layer tags** (7-color label system, same across themes):
Red, Orange, Yellow, Green, Blue, Purple, Gray.

## Typography

The typographic hierarchy uses four specialized font families, each assigned by role (never by surface):

### Font Families

| Role | Family | Use |
|------|--------|-----|
| **Interface** (`--font-display`) | Geist Variable | All UI chrome: navigation, buttons, menus, labels, coordinates, panel headings |
| **Body** (`--font-body`) | IBM Plex Sans Variable | Reading text: paragraphs, descriptions, help copy, tooltips |
| **Editorial** (`--font-editorial`) | Fraunces Variable | Brand display: wordmark, marketing headlines, welcome screen |
| **Mono** (`--font-mono`) | SF Mono / Cascadia Code / JetBrains Mono | Code, coordinates, measurements, numeric readouts |

### Typographic Roles

| Role | Size | Line Height | Weight | Family |
|------|------|-------------|--------|--------|
| `interface-control` | `--font-size-sm` | control (1.25) | medium (500) | interface |
| `interface-label` | `--font-size-sm` | label (1.35) | medium (500) | interface |
| `interface-body` | `--font-size-md` | normal (1.5) | regular (400) | interface |
| `interface-caption` | `--font-size-xs` | label (1.35) | regular (400) | interface |
| `interface-title` | `--font-size-lg` | tight (1.15) | semibold (600) | interface |
| `content-body` | `--font-size-md` | relaxed (1.65) | regular (400) | body |
| `content-lead` | `--font-size-lg` | relaxed (1.65) | regular (400) | body |
| `display-page` | `--font-size-2xl` | tight (1.15) | bold (700) | editorial |
| `display-section` | `--font-size-xl` | tight (1.15) | bold (700) | editorial |
| `marketing-hero` | clamp(2rem, 4.5vw + 0.5rem, 3.5rem) | 1.08 | bold (700) | editorial |
| `marketing-display` | clamp(3rem, 6.5vw + 0.75rem, 6rem) | 0.95 | bold (700) | editorial |
| `data-numeric` | `--font-size-sm` | control (1.25) | medium (500) | mono |

### Size Scale

Fluid `clamp()` values that respond to viewport width:
`2xs` → `xs` → `sm` → `md` → `lg` → `xl` → `2xl` → `3xl`

### Numerical Alignment

Numeric inputs (X, Y, W, H, Rotation, Opacity) must enforce tabular lining figures (`font-variant-numeric: tabular-nums`) to prevent horizontal jitter during cursor scrub and animated updates.

## Layout & Spacing

The layout model is a modular desktop workbench divided into four primary spatial zones. All dimensions are fluid (`clamp()`) to adapt across screen sizes while maintaining density.

### Spatial Zones

| Zone | Width | Token |
|------|-------|-------|
| **Left Sidebar** | fluid `clamp(14rem, 12rem + 8vw, 18rem)` | `--sidebar-width` |
| **Central Canvas** | flexible `1fr` | — |
| **Right Inspector** | fluid `clamp(15rem, 13rem + 8vw, 20rem)` | `--inspector-width` |
| **Top Menubar** | fluid `clamp(2.25rem, ..., 2.5rem)` height | `--topbar-height` |
| **Floating Toolbar** | fluid `clamp(2.5rem, ..., 3rem)` height | `--toolbar-height` |
| **Panel Section Header** | fluid `clamp(2rem, ..., 2.25rem)` height | `--panel-header-height` |

### Spacing Scale

32-step fluid scale from `0` to `32` using `clamp()` for responsive density. The 4px baseline sub-unit anchors the lower end:

| Token | Approximate Value | Use |
|-------|-------------------|-----|
| `space-0` | 0 | Reset |
| `space-05` | ~1.3px | Micro gaps |
| `space-1` | ~3px | Tight inline gaps |
| `space-2` | ~5-6px | Control padding, icon-label gaps |
| `space-3` | ~8-10px | Panel compact padding, control groups |
| `space-4` | ~11-14px | Panel padding, dialogs, form fields |
| `space-5` | ~16-20px | Gutter, page inline |
| `space-6` | ~22-30px | Card padding |
| `space-7` | ~32-42px | Large gaps |
| `space-8` | ~44-60px | Empty states |

### Semantic Spacing Roles

| Role | Token | Value |
|------|-------|-------|
| `panel` | `--space-panel` | `var(--space-4)` |
| `panel-compact` | `--space-panel-compact` | `var(--space-3)` |
| `toolbar` | `--space-toolbar` | `var(--space-2)` |
| `control` | `--space-control` | `var(--space-2)` |
| `form-field` | `--space-form-field` | `var(--space-4)` |
| `menu-item` | `--space-menu-item` | `var(--space-1)` |
| `tooltip` | `--space-tooltip` | `var(--space-2)` |
| `popover` | `--space-popover` | `var(--space-3)` |
| `dialog` | `--space-dialog` | `var(--space-4)` |

### Separator Recipes

| Token | Value |
|-------|-------|
| `--separator-thickness` | 1px |
| `--separator-content-gap` | `var(--space-3)` |
| `--separator-inset` | `var(--space-4)` |
| `--separator-min-length` | `var(--space-4)` |

## Elevation & Depth

Visual hierarchy is communicated through structural strata surfaces, delicate micro-borders, and ambient occlusion. The elevation system is theme-adaptive.

### Elevation Surfaces

| Level | Dark | Light | HC | Z-Index |
|-------|------|-------|-----|---------|
| Sunken | `oklch(0.12 ...)` | `oklch(0.945 ...)` | `oklch(0 0 0)` | 0 |
| Default | `oklch(0.18 ...)` | `oklch(0.976 ...)` | `oklch(0 0 0)` | 1 |
| Raised | `oklch(0.22 ...)` | `oklch(1.0 ...)` | `oklch(0.15 0 0)` | 100 |
| Overlay | `oklch(0.27 ...)` | `oklch(1.0 ...)` | `oklch(0.2 0 0)` | 1000 |

### Elevation Shadows

| Level | Dark | Light | HC |
|-------|------|-------|-----|
| Raised | `0 4px 12px oklch(0 0 0 / 0.3)` | `0 4px 12px oklch(0 0 0 / 0.14)` | `0 0 0 2px white` (outline) |
| Overlay | `0 12px 32px oklch(0 0 0 / 0.45)` | `0 12px 32px oklch(0 0 0 / 0.2)` | `0 0 0 3px white` (outline) |

### Border Discipline

Hairline 1px borders define all functional boundaries:
- **Dark mode:** `1px solid oklch(1 0 0 / 0.08)` — subtle white-on-dark edges
- **Light mode:** `1px solid oklch(0 0 0 / 0.08)` — subtle black-on-light edges
- **HC mode:** `2px solid white` — maximum-contrast structural edges
- **Accent borders:** `1px solid oklch(0.779 0.1229 188.31 / 0.25)` (dark) / `0.3` (light)
- Selected, hovered, or active containers shift their micro-border to the accent color.

### Scrim Overlay

Semi-transparent backdrop behind dialogs and popovers:
- Dark: `oklch(0 0 0 / 0.65)`
- Light: `oklch(0 0 0 / 0.55)`
- HC: `oklch(0 0 0 / 0.7)`

## Shapes

Semantic radius tokens replace raw values. Components consume named tokens, not raw pixel values:

| Token | Value | Use |
|-------|-------|-----|
| `--radius-none` | 0 | Sharp edges |
| `--radius-control-compact` | 6px | Compact inputs, small toggles |
| `--radius-control` | 8px | Standard inputs, buttons, selects |
| `--radius-floating` | 14px | Floating panels, menus |
| `--radius-surface` | 14px | Surface containers |
| `--radius-card` | 18px | Cards, dialog containers |
| `--radius-device` | 40px | Device frames, large capsules |
| `--radius-pill` | 9999px | Badges, pills, tags |

## Motion

Duration and easing tokens for consistent animation across the UI:

### Duration Scale

| Token | Value | Use |
|-------|-------|-----|
| `--duration-instant` | 50ms | Micro-feedback (opacity flash) |
| `--duration-quick` | 100ms | Hover state transitions |
| `--duration-fast` | 150ms | Focus rings, small reveals |
| `--duration-base` | 250ms | Standard panel transitions |
| `--duration-slow` | 400ms | Complex animations |
| `--duration-slower` | 600ms | Page-level transitions |
| `--duration-emphasis` | 1600ms | Hero glow, brand moments |
| `--duration-emphasis-loop` | 4800ms | Looping brand animations |

### Easing Curves

| Token | Value | Use |
|-------|-------|-----|
| `--ease-default` | `cubic-bezier(0.4, 0, 0.2, 1)` | General transitions |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bouncy overshoot |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exiting elements |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Entering elements |

## Component States

Interactive tokens encode every state a control can occupy:

| State | Token Pattern | Description |
|-------|---------------|-------------|
| Default | `interactive-default` | Resting state |
| Hover | `interactive-hover` | Pointer over element |
| Pressed | `interactive-active` | Mouse down / touch |
| Selected | `interactive-selected-surface` + `interactive-selected-border` | Active selection |
| Selected hover | `interactive-selected-surface-hover` | Hover on selected |
| Checked | `interactive-checked-surface` | Toggle/radio on |
| Focused | `interactive-focus-ring` | Keyboard focus indicator |
| Disabled | `interactive-disabled` | Non-interactive state |
| Drop target | `interactive-drop-target-surface` + `border` | Valid drag-over |
| Drop denied | `interactive-drop-denied-surface` + `border` | Invalid drag-over |

### Focus Management

Focus rings use `interactive-focus-ring` at 2px offset. The ring color is theme-adaptive: teal in dark/light, yellow-green in HC.

## Feedback

Status colors for success, warning, danger, and info states:

| Token | Base | Strong (filled bg) | Use |
|-------|------|--------------------|-----|
| `feedback-success` | green hue | `ok(0.47, 0.11, 156)` | Success messages, valid states |
| `feedback-warning` | amber hue | `ok(0.46, 0.12, 70)` | Warnings, caution |
| `feedback-danger` | red hue | same as base | Errors, destructive actions |
| `feedback-info` | blue hue | — | Informational |

**Text-on-feedback:** White in dark/light; black in HC (bright fills need dark text).

## Accessibility (WCAG 2.2)

The token audit enforces contrast ratios on every declared pair:

| Grade | Minimum Ratio | Applies To |
|-------|---------------|------------|
| AA | 4.5:1 | Body text, labels, links |
| AAA | 7:1 | Enhanced readability (optional) |
| UI | 3:1 | Interactive elements, icons, focus rings |

**Enforced pairs** (30+ in `CONTRAST_PAIRS`):
- `text-primary` on every surface elevation
- `text-on-accent` on `interactive-default`
- `text-on-feedback` on every feedback fill
- `interactive-selected-foreground` on `interactive-selected-surface`
- All layer accent colors on `tree-row` background
- Per-elevation text variants (`text-primary-on-default`, `text-primary-on-raised`, etc.)

**Known fixes documented in code:**
- Light mode: `text-subtle` adjusted from neutral 6 (L=0.68, 2.1:1 fail) to L=0.46 (4.5:1 pass)
- Light mode: `text-muted` adjusted from neutral 8 (L=0.473, 4.37:1 fail) to L=0.43 (5.0:1 pass)
- `accent-on-subtle`: teal-on-teal-wash was 1.60:1; uses per-theme value (Light: T12, Dark: T6, HC: accent-primary)
- `text-on-feedback`: white on success/warning fills was 3.25:1/3.42:1; strong fills + separate token fix it

## Micro-Interactions

### Search Highlights

| Token | Purpose |
|-------|---------|
| `highlight-search-match` | Non-selected matches (amber tint) |
| `highlight-search-current` | Active match (deeper amber) |

### Text Selection

| Token | Purpose |
|-------|---------|
| `highlight-text-selection` | Selection background |
| `highlight-text-selection-foreground` | Text color during selection |

### Tree (Layer Panel)

| Token | Purpose |
|-------|---------|
| `tree-row` | Default row background |
| `tree-row-hover` | Hovered row |
| `tree-row-selected` | Selected row |
| `tree-row-focus` | Keyboard-focused row |
| `tree-indent-guide` | Vertical indentation line |

## Signature Accents

Per-feature identity tokens (P3 color range, presentational only — not for text-on-background):

| Token | Hue | Use |
|-------|-----|-----|
| `--color-signature-branch` | warm amber-gold | Version/branching concept |
| `--color-signature-audit` | muted violet | Accessibility/quality audit tab |
| `--color-signature-ai` | electric teal-P3 | On-device AI features |

## Legacy & Compatibility

The following aliases exist for backward compatibility during migration:
- `--color-surface-default` → `--color-surface-base`
- `--color-on-accent` → `--color-text-on-accent`
- `--color-accent-hover` → `--color-interactive-hover`
- `--radius-sm/md/lg/xl/2xl` → semantic radius tokens
- `--shadow-*` → `--elevation-shadow-*`
- `--z-*` → `--elevation-z-*`

New code must use the canonical token names. Legacy aliases will be removed when all consumers are migrated.
