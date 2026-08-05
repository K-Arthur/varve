# ADR-0016: Native responsive tables and linked variable color modifiers

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Users simulate tables with nested Auto Layout frames, synchronized column
widths, and manual selection; linked colors cannot be modified without
destroying the variable relationship. Two first-class document capabilities
are required:

1. A semantic, responsive table node with stable identities, spans, headers,
   deterministic layout, editing, and interoperability.
2. Typed, non-destructive relative color modifiers (alpha first) applied on
   top of variable bindings, surviving every document pipeline.

## Decisions

### D1 — Table persistence: dedicated `TableNode` with an embedded data-backed model

A new `kind: 'table'` node carries `table: TableModel` (row/column/cell
definitions, spans, header/frozen configuration, responsive rules, appearance)
directly in the persistent node. No table cell is a scene node. Plain-text
cells are lightweight records (`{ text }`); a cell may optionally reference a
scene subtree via a content-slot id for rich compositions (v1 renders text
cells; rich slots are a documented follow-up).

Rationale: a 10,000-cell table as scene nodes would create a 10,000-node tree
(undo payloads, layers panel, hit testing, collaboration all degrade). One
node + data keeps undo snapshots small (immutable structural sharing already
makes document snapshots cheap), keeps the layers panel at one entry, and lets
the render layer compile the table into existing primitives on demand.

Alternative rejected: containers with first-class table metadata (option 3)
because it forces the table to be a frame whose children are cells, which
re-introduces node count and selection complexity. Option 4 (pure data-backed
virtualized model) was the direction, but the node still needs to live in the
scene tree for transform/opacity/layer semantics — hence the hybrid: a
`TableNode` whose *content* is data.

### D2 — Large-table representation: data-backed cells, one node, virtualized paint

The table model stores cells as records in maps keyed by stable ids. The
render compiler emits one engine item per *visible cell* only for the cells
inside the canvas viewport (viewport culling already exists at the node
level; table-level culling computes cell rectangles and skips offscreen
cells). Measured targets: 10,000 cells well under frame budget; documented
safe limits are enforced at import (rows/columns/cells/text length).

### D3 — Table rendering: compile to a single engine `table` primitive

The scene→engine conversion (`sceneToEngine.ts`) runs `computeTableLayout`
and produces one `EngineNode` whose shape is `{ kind: 'table', … }` carrying
precomputed cell geometry, fills, borders, and text items. The engine IR
passes it through and `replay.ts` paints it (cell rects, dividers, text)
reusing existing paint helpers.

Rationale: keeps the 1 scene node ↔ 1 render item ↔ 1 IR item invariant
intact, so the existing engine memo, subtree IR cache, dirty-replay set,
`irByNodeId` replay, worker renderer, export flattening, and WebGPU fallback
(which routes non-GPU primitives through Canvas2D present) all work without
structural changes to the hot paths. The persistent document never flattens
the table into frames; compilation is per-frame and cached by content hash.

The Rust crates (`varve-bridge`, `varve-core`, `varve-engine`) gain a
pass-through `table` shape/primitive variant so the native desktop engine
does not reject frames containing tables (a rejection would trip the
`withStubFallback` circuit breaker and degrade the whole session to the JS
stub renderer).

### D4 — Table layout: dedicated deterministic multi-pass algorithm

`computeTableLayout` in `packages/editor/src/layout/` (owned by the layout
layer, reusing `measureText` for deterministic intrinsic measurement):

- Pass 1: resolve column tracks (fixed px, percent of available width,
  content = max-content of unspanned cells, fraction fills remaining).
- Pass 2: resolve row heights; content rows take the max wrapped text height
  over all unspanned cells in the row (row-height synchronization).
- Pass 3: spanning cells widen spanned tracks if their own content exceeds
  the sum (minmax-style), bounded by a convergence limit (max 8 iterations),
  then re-resolve fractions.
- Non-finite results clamp to finite fallbacks; percentage tracks with an
  indefinite width fall back to content sizing.

CSS Grid (`computeGridLayout`) was evaluated and rejected as the table layout
engine: it is single-pass, position-only, and treats auto rows as the full
container height; tables need two-pass intrinsic sizing, row-height
synchronization across spans, and bounded convergence. The table algorithm is
a new module that does not modify the existing grid engine.

### D5 — Typed variable modifiers, alpha first

`PropertyBinding` gains `modifiers?: VariableModifier[]`. A modifier is a
typed union, not a string:

```ts
type VariableModifier =
  | { kind: 'alpha'; operation: 'multiply'; value: number }
  | { kind: 'alpha'; operation: 'set'; value: number }
  | { kind: 'alpha'; operation: 'offset'; value: number };
```

Resolution order (tested): resolve variable (collection mode → alias chain →
type validation) → canonical `ManagedColor` → apply modifier stack in array
order (multiply = `a × value`, set = `value`, offset = `a + value`, clamped
to `[0, 1]`) → renderer color → paint-level opacity → node-level opacity
during compositing. Node opacity is never applied twice: modifiers only touch
the fill's alpha channel; the node keeps its own `opacity` property.

The existing free-form numeric `expression` field is untouched and stays
numeric-only; alpha modifiers never flow through it. Future modifiers
(lightness/chroma/hue/tint/mix) get new typed variants; nothing is exposed
in the UI before it is implemented.

### D6 — Missing/invalid variable policy: preserve, warn, repair

A binding whose variable is missing or whose type changed to non-color keeps
the binding and the modifiers; `applyBindingsToNode` falls back to the last
known value exactly as today (fail-soft), and the inspector shows a warning
state with reconnect/detach affordances. `deleteVariableFromDocument` still
strips bindings when the user deletes the variable through the official API —
that is the explicit detach path.

### D7 — Package ownership

| Capability | Package |
| --- | --- |
| Table document schema, stable ids, validation, structural ops, serialization, migrations, clipboard closure | `@varve/scene` |
| Table track sizing, intrinsic measurement, span resolution, responsive reflow, computed geometry | editor `layout/` (per D4) |
| Table render preparation, IR payload, hit testing | `@varve/engine` + editor `render/` |
| Effective color/alpha compositing, backend parity | `@varve/engine` replay + `@varve/compositor` |
| Table tool, selection, canvas overlays, inspector sections, modifier controls, commands, keyboard | `@varve/editor` |
| Deterministic CSV/TSV/Markdown/JSON parsing, formula-safe export | `@varve/import` (+ `@varve/codegen` for export) |
| Screenshot analysis (optional, local-first, schema-validated plans) | `@varve/ai` (deferred to a later milestone) |

## Consequences

- One new node kind flows through the node union, clone, codec, migration,
  hit test, flatten, engine conversion, SVG export, and codegen switches.
  Every such switch is a deliberate small case; none flatten the table into
  the document.
- The Rust engine wire contract gains one pass-through variant; desktop keeps
  native IR building for documents containing tables.
- Documents saved before 2.15 load unchanged (optional fields); documents
  with tables are rejected by older versions via the forward-compat guard.
- The multimodal table pipeline (image analysis) is explicitly deferred:
  deterministic structured import ships now, image inference later.
