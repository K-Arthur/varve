# Varve Icon Naming Conventions and Visual Standards

Canonical source of truth for internal UI icon *naming*. Feature code
references semantic names (via `SemanticIcon` from `@varve/ui`). Outline
icons render from Tabler by default (Lucide as the fallback family for
concepts not yet mapped in `TABLER_SEMANTIC_ICONS`); filled surfaces render
Phosphor. The current-state contract — resolution order, component APIs,
library choice rationale — lives in `docs/design/icon-system.md`; this doc
records the naming rules and visual standards.

## 1. Semantic naming rules

- **Action/concept names, not visual descriptions.** `Delete`, not
  `TrashCanOutlineIcon`; `Union`, not `CombinePaths`.
- **PascalCase, letters only.** No digits, no `Alt`, no `2` suffixes
  (`Add2`, `CloseAlt` are banned).
- **No generic names.** `Arrow`, `Action`, `New`, `Generic` are reserved and
  rejected by `validateSemanticIconNames()`.
- **One concept, one name.** The same action on the toolbar, menu, and
  inspector must resolve through the same semantic name so visual
  replacement is a one-line registry change.
- **Prefer the verb/object pair:** `Delete`, `Copy`, `Download`, `ZoomIn`,
  `AlignLeft`, `RotateRight`, `FontSize`.

Name categories (as used in `SEMANTIC_ICONS`):

| Category | Examples |
|---|---|
| Actions | `Add`, `Delete`, `Close`, `Check`, `Save`, `Copy`, `Undo`, `Redo` |
| Objects | `FileText`, `Folder`, `FolderOpen`, `Bookmark`, `BookmarkFilled` |
| States | `Visible`, `Hidden`, `Lock`, `Unlock`, `Pin`, `Unpin` |
| Tools | `Select`, `Frame`, `Pen`, `Pencil`, `Text`, `Image`, `Hand`, `Eraser` |
| Navigation | `Back`, `Forward`, `Home`, `Up`, `Down`, `Previous`, `Next` |
| Status | `Warning`, `Success`, `Error`, `Info`, `Spinner` |
| Alignment | `AlignLeft`, `AlignCenter`, `AlignRight`, `AlignJustify` |
| Transform | `Union`, `Subtract`, `Intersect`, `Exclude`, `RotateLeft`, `RotateRight` |
| Media | `Play`, `Pause`, `Record`, `Stop` (as needed) |

## 2. Visual standards

- **Grid:** 24 × 24 viewBox, 2 px stroke at regular weight (Tabler, Lucide,
  and Phosphor regular all conform).
- **Optical bounds:** glyphs sit within the 24 × 24 box with consistent
  internal padding; no glyph fills the full box edge-to-edge unless the
  concept is a filled square.
- **Colour:** always `currentColor` — never hard-coded black/white fills in
  general-purpose icons. Theme and high-contrast modes inherit automatically.
- **Sizing:** use the semantic tokens `xs` (12), `sm` (14), `md` (16),
  `lg` (20), `xl` (24). Avoid scattered pixel values; document any optical
  corrections explicitly.
- **Hit targets:** glyph size and button hit area are separate concepts.
  A 16 px icon may live in a 32 px button.
- **Families:** outline (Tabler, Lucide fallback) is the default; filled
  (Phosphor) is used for surfaces that intentionally use filled icons. Do not
  mix families for the same concept in one surface without a documented reason.

## 3. RTL behaviour

Only icons in `DIRECTIONAL_ICONS` may be mirrored (`Back`, `Forward`,
`Undo`, `Redo`, `Previous`, `Next`, `RotateLeft`, `RotateRight`). Icons whose
meaning is not directional (`Warning`, `Star`, `Search`) must never flip.
Mirroring is opt-in via the `mirror` prop — directional containers decide,
not the icon.

## 4. Accessibility contract

- `label` prop → `role="img"` + `aria-label` (functional icon).
- No `label` → `aria-hidden="true"` + `focusable={false}` (decorative icon;
  the surrounding visible text names the action).
- Icon-only buttons need a `Tooltip` and an accessible name on the button —
  never the SVG filename.
- Status must never rely on colour alone; pair with text or `aria-*` state.

## 5. Adding an internal icon

1. Add the semantic name to the `SemanticIconName` union.
2. Add the entry to `SEMANTIC_ICONS` with an outline and a filled (Phosphor)
   name; if Tabler has a better-matching glyph, also add the concept to
   `TABLER_SEMANTIC_ICONS` so the outline family resolves to Tabler first.
   Verify the names exist in the *installed* library versions (lucide 1.x
   renamed several icons: `AlertTriangle` →
   `TriangleAlert`, `CheckCircle2` → `CircleCheckBig`, `XCircle` → `CircleX`,
   `Loader2` → `LoaderCircle`, `Rows` → `Rows2`, `Columns` → `Columns2`,
   `Layout` → `PanelTop`).
3. Run `validateSemanticIconNames()` (via the registry tests) and the icon
   render tests — every entry renders in both families.

## 6. Replacing an icon safely

Change only the `SEMANTIC_ICONS` entry. Feature code that uses the semantic
name updates automatically. If the replacement changes the visual meaning,
rename the semantic name instead and migrate call sites explicitly — never
repurpose an existing name silently.
