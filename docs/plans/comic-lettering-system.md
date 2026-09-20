# Comic lettering system — architecture, admission matrix, and slice ledger

Status: active. Canonical contracts live in
`docs/architecture/comic-workflow.md`; research evidence and complaints in
`docs/research/comic-lettering-research-2026-09-19.md`; capability and visual
evidence in `docs/audits/comic-lettering-capability-audit-2026-09-19.md`.

## Architecture decision

The question this record answers: how are balloons represented, given that
Varve already has text, shapes, groups, masks, effects, warp, pages, and
export?

| | Model | Why it wins or loses |
| --- | --- | --- |
| A | Generic shape + text relationship | The chosen model. Body, tails, and text stay ordinary nodes; a recipe on the group records semantics and authored policy. One renderer, one codec, one history, one export path. |
| B | Dedicated `BalloonNode` | Rejected. Forks the schema, renderer, migrations, hit testing, and export for zero new capability; defeats "balloons are not a second document model". |
| C | Composite/group preset | Rejected as the *only* model. A preset without a relationship cannot coordinate fit, tails, or text replacement. Presets remain useful as starting recipes. |
| D | Relational decoration system | Rejected for now. A decoration relationship is a second selection and z-order model; scene children already express it. |
| E | Structured group with authored recipe + derived geometry | **Chosen.** `GroupNode.callout` names body/text/tail nodes; `wrapShape` and fit policy are authored; per-line widths, fit status, and chain geometry are derived and never serialized. |

Answering the required questions directly:

- **Text ownership**: the `TextNode` survives; `wrapTextInCallout` moves the
  existing node into the group. Text content, style, and story binding are
  never copied.
- **Outline ownership**: an ordinary `ShapeNode` rect with corner radius, a
  normal child of the group.
- **Tail ownership**: ordinary path (pointed) or circle (thought) nodes, with
  `CalloutTail` recording which nodes form one logical tail and its authored
  curve/base width.
- **Style ownership**: the recipe's `kind` selects defaults; `wrapShape` is the
  only style-like override that persists, because kind changes re-apply
  defaults while explicit author choices must survive.
- **Selection**: the group on canvas; body/tail/text via the layer tree and the
  existing deep-selection model. No second selection mode.
- **Layers**: the group appears as one row; children are the ordinary body,
  tail(s), and text rows. The hierarchy shown is the document's real semantics.
- **Copy/paste, duplicate, undo, export**: unchanged scene paths; the recipe is
  a plain field on the group, and node ids are remapped by the existing clone
  and paste logic.
- **Serialization**: additive optional fields (`CalloutRecipe.wrapShape`,
  `CalloutRecipe.tails`, `CalloutTail`); documents from before the field read
  as one pointed tail per `tailNodeIds` entry. No migration is required.
- **Migration**: none. Unknown fields remain handled by the codec.
- **Export**: balloons are shapes, paths, and text, so every exporter already
  handles them. Text strokes paint from the canonical layout so outlines and
  fills agree on wrapped lines.

## Text layout integration

- Authored: `textWrapShape` on the `TextNode` (`'rect' | 'ellipse'`), plus the
  text itself.
- Derived: `ellipseLineWidthProfile(width, lineCount)` in
  `packages/shared/src/balloonTextLayout.ts`. The scene resolver and the engine
  layout both iterate the same rule (rect pass to count lines, profile, repeat
  to a stable count).
- Parity is enforced by `packages/engine/src/balloonWrapParity.test.ts`:
  identical line breaks for natural dialogue, short lines, and a German
  localization expansion.
- Overflow is derived state from the same geometry; no clipping without a
  status.

## Feature admission matrix

| Feature | User problem | Evidence | Reuse | UI cost | Architecture cost | Perf | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ellipse/speech balloon | Baseline workflow | CSP/lettering conventions | Group + shape + text | Inspector section (exists) | Recipe only | O(1) | Implemented |
| Curved/width tail | Tails welded to balloon, only taper | CSP tail complaints; Blambot conventions | Path node + handles | Slider/field + flip/remove | `CalloutTail` | O(1) | Implemented |
| Thought chain | Three decreasing circles convention | Blambot grammar | Circle nodes | Kind switch | Chain geometry | O(1) | Implemented |
| Caption/whisper/shout recipes | Voice conventions | Blambot; lettering practice | Existing styles | Kind select | None new | O(1) | Implemented |
| Contour-aware wrap | Rectangular wrap in round balloons | CSP/Krita complaints; 94% line rule | Canonical layout, both engines | Line shape select | One profile derivation | 0.024 ms/balloon at 500 | Implemented |
| Auto-width stacking on creation | Ribbon balloons from single-line text | Lettering measure practice | `fitCalloutToText` | None | Creation cap + fixed container | O(1) | Implemented |
| Fit balloon to text | Balloon too big / text too small | CSP "no auto-fit" threads | Shared geometry | Fit button (exists) | Bounded fixpoint | 0.34 ms single | Implemented |
| Overflow/near-overflow status | Silent clipping/forced shrink | Lettering guidance | Canonical layout metrics | Status line (exists) | None | O(1) | Implemented |
| Text stroke on wrapped text | Outline detached from wrapped glyphs | Export parity; SFX practice | Canonical snapshot | None | Stroke painter | Same as fill | Fixed |
| SFX/text-effect preset library | SFX drawn outside the app; one hard-coded style | Manga localization SFX policy; published lettering practice | TextNode fields only | Preset select | Low | O(1) | Implemented (six presets, no bundled assets) |
| Burst and cloud balloons | Speech/thought/caption shapes only | CSP balloon materials; CC0 SVG structure | Star outline + existing recipe | Kind options | `outlineNodeId` | O(1) | Implemented |
| Direct balloon text editing | Layer-tree hunt for every line | CSP double-click editing | Existing text editor | None | None | O(1) | Implemented |
| Per-glyph jitter/radial SFX | Display lettering variety | Lettering books | Warp/glyph adjustments — warp rejects multi-line/RTL | Preset + controls | Needs deterministic seeds and hit testing | Unknown | Defer; expose existing warp first |
| Speaker-object targeting | Tails follow speakers | CSP discussions; risk of hidden state | Needs persistent reference | Overlay + Inspector | New relationship + deletion handling | O(1) | Defer; explicit endpoint only |
| Joined balloons | Sequential/alternating dialogue | Blambot; CSP threads | Multiple tails + groups | Connector UI | Model for shared outlines | O(1) | Defer after core stabilizes |
| Reading-order assistance | Placement is reading order | Manga/localization workflows | Story outline metadata exists | Optional overlay | Derivation only | O(n) | Defer (metadata exists) |
| Script import | Chapter workflows | Script basics (Blambot) | Story outline + text | Separate surface | High | — | Decision gate, not in core |
| Auto placement/AI lettering | Can destroy authored pages | Localization vendors on HITL | None safe | — | — | — | Reject for core |

## Slice ledger

1. **Relationship foundation** (landed before 2026-09-20): group recipe,
   ordinary nodes, Inspector, serialization, undo.
2. **Tail system** (2026-09-20): logical tails, curve, base width, flip,
   remove, thought chains, fit-preserving tips.
3. **Contour layout** (2026-09-20): line-count profile, scene/engine parity,
   auto-width stacking, fit fixpoint, fit status.
4. **Stroke parity** (2026-09-20): canonical wrapped text stroke.
5. **Visual validation** (2026-09-20): five real-flow E2E scenarios and the
   capture set in `docs/screenshots/comic-lettering/`.
6. **Remaining** (not started): canvas balloon-drawing tool, canvas tail
   handles, joined balloons, per-glyph deterministic SFX effects, vertical
   contour columns, comic-specific RTL fixtures, batch lettering navigation,
   script import decision.
7. **Shaped balloons, presets, and direct editing** (2026-09-20): Burst and
   Cloud star-outline kinds; the text-effect/SFX preset library; double-click
   balloon editing; clone/paste recipe remapping; real-photo E2E validation in
   `tests/e2e/canvas/comic-workflow.spec.ts` with captures in
   `docs/screenshots/comic-workflow/`. Research and licensing for the preset
   vocabulary: `docs/research/comic-preset-svg-research-2026-09-20.md`.
8. **Known defect**: live canvas loses shape corner radii despite correct IR
   (see the audit); fix in the editor frame path.

## Validation economy

Per `AGENTS.md`: `pnpm verify:plan` → `pnpm verify:affected` for code changes;
`pnpm bench:lettering` for the perf-sensitive profile derivation; the E2E spec
under the heavy-task lease for visual work. The full suite is a release-gate
operation, not the inner loop.
