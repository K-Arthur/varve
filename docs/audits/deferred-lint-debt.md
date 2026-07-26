# Deferred Lint Debt

These warnings require genuine component redesign or are legitimate use cases
of ARIA/HTML patterns that Biome's `useSemanticElements` cannot express.

Last updated: 2026-07-25

Attempted Phase 1 Sprint A/B/C (127→21 achieved, then reverted by `git checkout -- .`).
Current count: 153 warnings. Re-apply fixes from session history.

## Remaining warnings (21 total)

### noArrayIndexKey (6 warnings)

These use array index as key because position *is* the identity for ordered
effect/stroke/fill lists. Fixing them requires either:
- Adding stable IDs to the data model (scala effort, cross-cutting)
- Accepting that `key={i}` is correct for non-reorderable lists

| File | Line | Required redesign |
|------|------|-------------------|
| `Inspector/sections/EffectsSection.tsx` | 263 | Add stable IDs to effect model |
| `Inspector/sections/FillSection.tsx` | 192 | Add stable IDs to fill model |
| `Inspector/sections/StrokeSection.tsx` | 181 | Add stable IDs to stroke model |
| `SpecPanel/CodeGenView.tsx` | 116 | highlightedLines are line-number-indexed; stable by nature |
| `timeline/GraphEditor.tsx` | 334 | keyframes array — needs kf.id or composite key |
| `panels/IntelligencePanel.tsx` | 367, 902, 1041, 1219, 1310, 1458, 1518, 1635 | Several `noArrayIndexKey` that use positional identity for grouped findings |

### useSemanticElements (14 warnings)

These use `role` attributes on elements that cannot be replaced with semantic
HTML without losing essential interactivity or visual structure.

| File | Line | Pattern | Required change |
|------|------|---------|-----------------|
| `PropertiesPanel.tsx` | 221 | `role="button"` on backdrop overlay | Overlay must be fixed-position; `<button>` needs CSS adjustments |
| `DisclosureSection.tsx` | 168 | `<section>` with context menu | Context menu interaction is supplementary |
| `RichTextSpanEditor.tsx` | 83 | contentEditable `role="textbox"` | Cannot use `<textarea>` — needs rich text formatting |
| `LayersRow.tsx` | 356 | `role="button"` on zoom icon | Double-click action, nested in layers row |
| `LibraryPanel.tsx` | 83 | `role="button"` on library item | Has nested `<Button>` child |
| `PanelResizeHandle.tsx` | 136 | `role="separator"` on resize handle | `<hr>` is horizontal only and can't be focusable |
| `PreflightWarnings.tsx` | 138 | `role="button"` on backdrop overlay | Same as PropertiesPanel backdrop |
| `PrototypePlayer.tsx` | 48 | `role="button"` on interaction area | Full-area click zone |
| `PrototypePlayer.tsx` | 77 | `role="region"` on hints overlay | Generic landmark for overlay |
| `NewFeatureBadge.tsx` | 38 | `role="button"` on badge span | Badge with click interaction |
| `PlaybackControls.tsx` | 177 | `<time>` → should not have aria-label | Use `<span role="timer">` |
| `ContextualHelpPanel.tsx` | 54 | `role="complementary"` on panel | Need to change to `<aside>` |
| `ContextualHelpPanel.tsx` | 116 | `aria-selected` on `<li>` | Need `role="option"` on `<li>` |
| `AuditUtilityPanel.tsx` | 161 | `role="button"` on finding div | Clickable finding with nested content |
| `IntelligencePanel.tsx` | 182 | `role="group"` on more-groups div | Should be `<fieldset>` |

## Migration plan

| Phase | Target | Effort |
|-------|--------|--------|
| Sprint D | Fix 6 noArrayIndexKey by adding IDs to models | ~2 sessions |
| Sprint E | Fix 14 useSemanticElements by native HTML swap | ~2 sessions |
