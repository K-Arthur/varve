# Component Status — `@strata/ui` maturity tracker

**Last updated:** 2026-07-27
**See:** ADR-0011 (governance), `docs/design/design-principles.md`

## Maturity states

| State | Icon | Meaning |
|---|---|---|
| experimental | 🧪 | API unstable |
| beta | 🔨 | Limited production use |
| stable | ✅ | API locked, safe to depend on |
| deprecated | ⚠️ | Migrating away — no new consumers |
| removed | 🚫 | Gone |

## Foundational primitives

| Component | Maturity | Story | Test | Notes |
|---|---|---|---|---|
| Button | ✅ | ✅ | ✅ | 6 variants × 3 sizes |
| IconButton | ✅ | — | — | Wraps Button |
| Checkbox | ✅ | — | — | Includes indeterminate |
| Radio | 🧪 | — | — | Not yet extracted to @strata/ui |
| Switch | 🧪 | — | — | Not yet extracted |
| ToggleButton | 🧪 | — | — | Not yet extracted |
| Input (text) | 🧪 | — | — | NumberInput exists; generic Input does not |
| TextArea | 🧪 | — | — | Not yet extracted |
| NumberInput | ✅ | — | ✅ | Scrubbable |
| SearchField | ✅ | — | ✅ | With highlight match |
| Select | ✅ | ✅ | ✅ | APG combobox pattern |
| Combobox | 🧪 | — | — | Not yet extracted |
| Slider | ✅ | — | ✅ | APG slider pattern |
| Tabs | ✅ | — | ✅ | APG tabs + roving tabindex |
| SegmentedControl | ✅ | — | — | APG radiogroup |
| ViewModeSwitcher | ✅ | — | — | |

## Overlays & feedback

| Component | Maturity | Story | Test | Notes |
|---|---|---|---|---|
| Dialog | ✅ | ✅ | ✅ | Uses native `<dialog>` |
| AlertDialog | ✅ | — | — | Variant of Dialog |
| Popover | ✅ | ✅ | ✅ | `popover="auto"` + floating-ui |
| Tooltip | ✅ | ✅ | ✅ | Provider, warm timing, truncation-only mode |
| Menu | ✅ | — | ✅ | Full keyboard nav, typeahead, submenus |
| ContextMenu | ✅ | — | — | Hook + Menu composition |
| Toast | ✅ | ✅ | ✅ | With ToastProvider |

## Structure & layout

| Component | Maturity | Story | Test | Notes |
|---|---|---|---|---|
| Panel | ✅ | ✅ | ✅ | Draggable resize, localStorage |
| Toolbar | ✅ | — | — | APG roving tabindex |
| EmptyState | ✅ | ✅ | ✅ | |

## Feedback / status

| Component | Maturity | Story | Test | Notes |
|---|---|---|---|---|
| ContentSkeleton | ✅ | — | ✅ | |
| RegionLoader | ✅ | — | — | |
| StartupLoader | ✅ | — | ✅ | |
| DeterminateProgress | ✅ | — | — | |
| InlineActivityIndicator | ✅ | — | — | |
| CopyButton | ✅ | — | ✅ | |

## Domain-specific

| Component | Maturity | Story | Test | Notes |
|---|---|---|---|---|
| ColorPicker | ✅ | — | ✅ | Full subsystem (CMYK, gamut, spot) |
| PresetPicker | ✅ | ✅ | ✅ | |
| FocusTrap | ✅ | — | ✅ | Pointer-capture focus containment |
| FloatingPortal | ✅ | — | ✅ | |

## Missing primitives (not yet in `@strata/ui`)

These exist only as inline implementations in `packages/editor`. They should be
extracted to `@strata/ui` as `beta` components:

- Radio group
- Switch / toggle
- Toggle button
- Generic text Input
- TextArea
- Combobox (distinct from Select — free-text entry with suggestions)
- Tree / TreeGrid
- VirtualList (for large layer/component lists)
- Disclosure / accordion
- Badge / Tag
- Progress (indeterminate)
- Spinner
- Breadcrumbs
