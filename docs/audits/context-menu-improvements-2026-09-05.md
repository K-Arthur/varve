# Context Menu Improvements Audit

Date: 2026-09-05.

## Summary

Audit, improve, and visually verify every context menu and context-menu-like
interaction across all Varve applications and packages. This session focused on
strengthening the existing shared menu system rather than introducing a new one.

## Inventory of context menu surfaces

| # | Surface | File | Trigger | Shared Menu? |
|---|---------|------|---------|--------------|
| 1 | Canvas context menu | `menu/canvasContextMenu.ts`, `Shell.tsx` | Right-click / keyboard | Yes (`ContextMenu`) |
| 2 | Layers panel context menu | `LayersPanel/index.tsx` | Right-click / keyboard | Yes (`ContextMenu`) |
| 3 | Page nav context menu | `PageNav/PageNav.tsx` | Right-click | Yes (`ContextMenu`) |
| 4 | Guide context menu | `GuideOverlay/GuideContextMenu.tsx` | Right-click | Yes (`ContextMenu`) |
| 5 | Home file context menu | `home/FileContextMenu.tsx`, `HomeShell.tsx` | Right-click | Yes (`ContextMenu`) |
| 6 | Panel drag handle menu | `PanelDragHandle.tsx` | Right-click / keyboard | Yes (`ContextMenu`) |
| 7 | Disclosure section menu | `DisclosureSection.tsx` | Right-click / keyboard | Yes (`ContextMenu`) |
| 8 | Timeline marker menu | `TimelineRuler.tsx` | Right-click | Yes (`ContextMenu`) |
| 9 | Gradient preset menu | `GradientMapPresetBrowser.tsx` | Right-click | Yes (`ContextMenu`) |
| 10 | Breadcrumb overflow | `SelectionBreadcrumb.tsx` | Click | Yes (`Menu` dropdown) |
| 11 | SelectionQuickBar | `SelectionQuickBar.tsx` | Auto (selection) | Yes (`Menu` overflow) |
| 12 | FloatingToolbar overflow | `FloatingToolbar.tsx` | Click | Yes (`Menu` dropdown) |
| 13 | TouchCandidateMenu | `Breadcrumb/TouchCandidateMenu.tsx` | Touch long-press | Partial (FloatingPortal) |

All 9 context menus use the shared `ContextMenu` component from `@varve/ui`.
The only exception is TouchCandidateMenu which uses `FloatingPortal` directly
because it is a pick-through selector, not a traditional context menu.

## Changes made

### 1. Canvas context menu (`canvasContextMenu.ts`)

- Added section labels: Clipboard, Arrange, Clipping & Masking, Intelligence.
- Added icons: Scissors (Cut), Copy, ClipboardPaste (Paste), CopyPlus (Duplicate),
  Trash2 (Delete, Remove Mask), Group, Ungroup, Spline (Vectorize), Brain
  (Intelligence submenu), Download (Export Frame), MousePointer2 (Select All).
- Marked Delete and Remove Mask as `destructive: true`.
- Reorganized into logical groups with label headings.

### 2. Home file context menu (`FileContextMenu.tsx`)

- Added section labels: File, Organization, Order, State, Info, Danger Zone.
- Added icons: ExternalLink (Open), Pencil (Rename), CopyPlus (Duplicate),
  Folder/FolderOpen (project moves), ArrowLeft/ArrowRight (ordering),
  Star/StarOff (favorites), Pin/PinOff (pinning), Eye/EyeOff (hide/show),
  Clock (versions), FolderOpen (reveal), Trash2 (trash), RotateCcw (restore),
  FolderSearch (locate).
- Marked Move to Trash, Delete permanently, and Remove from recents as
  `destructive: true`.
- Danger Zone label uses `danger: true` for subtle danger styling.

### 3. Page nav context menu (`PageNav.tsx`)

- Added section labels: Page, Danger Zone.
- Added icons: Pencil (Rename), CopyPlus (Duplicate), ArrowLeft/ArrowRight
  (Move), Image (thumbnail).
- Marked both Delete items as `destructive: true`.
- Danger Zone label uses `danger: true`.

### 4. Guide context menu (`GuideContextMenu.tsx`)

- Added section label: Guide.
- Added icons: LockOpen/Lock (toggle lock), Trash2 (Delete).
- Marked Delete as `destructive: true`.

### 5. Timeline marker context menu (`TimelineRuler.tsx`)

- Added section label: Marker.
- Added icons: Pencil (Rename), Trash2 (Delete).
- Marked Delete marker as `destructive: true`.

### 6. Layers panel context menu (`LayersPanel/index.tsx`)

- Added section labels: Layer, Clipboard, Arrange, Visibility.
- Added icons: Pencil (Rename), Trash2 (Delete), Copy, Scissors (Cut),
  ClipboardPaste (Paste), ArrowUpToLine/ArrowDownToLine (Bring to Front/Send
  to Back), FoldVertical (Collapse Others), Focus (Isolate), Lock, EyeOff
  (Hide), Eye (Solo).
- Marked Delete and Remove Mask as `destructive: true`.

### 7. TouchCandidateMenu refactor (`TouchCandidateMenu.tsx`)

- Replaced all inline styles with shared `.varve-menu` CSS classes.
- Now uses `varve-menu__item`, `varve-menu__leading`, `varve-menu__item-content`,
  `varve-menu__item-label`, `varve-menu__trailing` classes.
- Consistent visual treatment with all other menus.
- Removed old `.touch-candidate-item` CSS (no longer needed).

### 8. Menu component improvements (`Menu.tsx`, `components.css`)

- Added `danger?: boolean` property to `MenuLabel` type.
- Labels with `danger: true` render with `varve-menu__label--danger` class
  (color: `--color-feedback-danger`).
- Added subtle entrance animation: `varve-menu-fade-in` (150ms, scale 0.97→1,
  opacity 0→1, ease-out).
- Animation respects `prefers-reduced-motion: reduce`.
- Removed unused `.touch-candidate-item` hover/focus CSS.

## Visual changes

### Menu entrance animation
- New: 150ms scale+opacity animation on menu open.
- Respects reduced motion: animation disabled when `prefers-reduced-motion: reduce`.
- Uses existing `--duration-fast` and `--ease-out` tokens.

### Destructive styling
- Destructive items use `--color-feedback-danger` text color.
- Destructive hover/focus uses `color-mix(in oklab, --color-feedback-danger 12%, transparent)`.
- Danger Zone labels use subtle danger text color.

### Section labels
- Labels are uppercase, small, semibold, letter-spaced.
- Danger Zone labels use danger color for visual hierarchy.

## Files changed

| File | Reason |
|------|--------|
| `packages/editor/src/menu/canvasContextMenu.ts` | Section labels, icons, destructive styling |
| `packages/editor/src/components/LayersPanel/index.tsx` | Section labels, icons, destructive styling |
| `packages/editor/src/components/PageNav/PageNav.tsx` | Section labels, icons, destructive styling |
| `packages/editor/src/components/GuideOverlay/GuideContextMenu.tsx` | Section label, icons, destructive styling |
| `packages/editor/src/timeline/TimelineRuler.tsx` | Section label, icons, destructive styling |
| `packages/home/src/FileContextMenu.tsx` | Section labels, icons, destructive styling |
| `packages/editor/src/components/Breadcrumb/TouchCandidateMenu.tsx` | Refactored to shared menu CSS |
| `packages/editor/src/components/Breadcrumb/selectionBreadcrumb.css` | Removed old inline-touch-candidate styles |
| `packages/ui/src/components/Menu.tsx` | Added `danger` prop on MenuLabel |
| `packages/ui/src/components/components.css` | Entrance animation, danger label style |
| `docs/architecture/menu-system.md` | Updated visual contract, content guidelines |

## Validation

- 84/84 tests pass (Menu, FileContextMenu, GuideContextMenu, PageNav, TimelineRuler).
- Typecheck passes for `@varve/ui`, `@varve/home`, `@varve/editor`.
- Pre-existing failures: `@varve/ui` Disclosure.stories.tsx type error, website
  tokens.test.ts download.astro raw token (both unrelated to this work).
- Formatting applied (Biome).

## Decisions

### Radial bubble menu: REJECTED (final evaluation)

The radial/pie-style menu pattern was evaluated against the full production
contract and rejected. Specific gaps identified:

| Requirement | Status |
|---|---|
| Semantic menu roles (`role="menu"`, `role="menuitem"`) | Missing |
| Roving tabindex keyboard navigation | Missing |
| Keyboard invocation (ContextMenu key, Shift+F10) | Missing |
| Screen-reader labeling | Missing |
| Disabled items | Missing |
| Checkbox and radio items | Missing |
| Separators and group labels | Missing |
| Submenus | Missing |
| Viewport collision handling (flip, shift, clamp) | Missing |
| Zero-item division (avoiding overlap) | Missing |
| Duplicate-label React key handling | Not addressed |
| Large item counts (>8 items) | Would cause overlap |
| Small viewport clipping | Not handled |
| RTL support | Not handled |
| Reduced-motion respect | Not handled |
| Owner-document and multi-window behavior | Not handled |
| Focus restoration on close | Not handled |
| Escape behavior (deepest-first) | Not handled |
| Resize and scroll repositioning | Not handled |
| Destructive action confirmations | Not handled |
| Drag and long-press gesture conflicts | Not handled |
| Platform shortcut metadata display | Not handled |

The radial pattern may be reconsidered **only** if a narrow, high-value use
case emerges (e.g., pen barrel-button quick actions with ≤6 stable items).
If implemented, it must be a separate optional primitive with an equivalent
conventional menu route, full keyboard/switch input support, and stable action
IDs. It must not replace the standard context menu system.

### New menu system: NOT INTRODUCED
All improvements use the existing shared `ContextMenu`/`Menu` primitives from
`@varve/ui`. No second menu system was created.

### Native context menus: NOT SUPPRESSED
The native browser context menu is suppressed only within application surfaces
that provide a complete Varve replacement. Text inputs, textareas, password
fields, links, and debugging contexts retain native menus.

### Marketing website: NO CHANGES NEEDED
The marketing website (`apps/website/`) is Astro-based with native navigation
and contains no context menus or right-click handlers. No changes required.

## Remaining deferred work

1. Gradient preset context menu (`GradientMapPresetBrowser.tsx`) could benefit
   from section labels and destructive styling on Delete.
2. Disclosure section context menu (`DisclosureSection.tsx`) is minimal (single
   "Hide section" item) and needs no enhancement.
3. Panel drag handle context menu (`PanelDragHandle.tsx`) is minimal (single
   "Detach Panel" item) and needs no enhancement.
4. Playwright E2E visual tests for context menu placement, collision, and
   animation should be expanded in a future session.
5. Radial/quick-action menu for pen/touch could be evaluated if a narrow
   high-value use case emerges.
