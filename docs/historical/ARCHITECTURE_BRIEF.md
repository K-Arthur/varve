# Varve Architecture Brief

> **Point-in-time snapshot (generated 2026-07-25).** This brief maps the
> subsystems as they were on that date: file/line references and schema
> versions (e.g. document schema 2.14) have moved since (schema is now 2.20,
> and there are seven workspace modes including `logo`). Verify against the
> current code before relying on any line number or version claim. Current
> guidance lives in `docs/architecture/` and the ADRs.

Generated: 2026-07-25
Scope: Everything an implementer needs to touch the following subsystems without re-deriving them.

---

## 1. DOCUMENT MODEL

### Node type hierarchy

**File:** `packages/scene/src/types.ts`

All nodes extend `NodeBase` (types.ts:904) and are discriminated by `kind`:

| Node Type | Interface | Line | Distinctive |
|-----------|-----------|------|-------------|
| `'shape'` | `ShapeNode` | 975 | `shape: Shape`, `transform`, `strokes`, `effects`, `cornerRadius`, `cornerSmoothing` |
| `'text'` | `TextNode` | 1010 | `text: RichText`, `fontSize/family/weight`, `richText?`, `textMode?` |
| `'group'` | `GroupNode` | 1099 | `transform`, `children: NodeId[]`, `isolated?` |
| `'frame'` | `FrameNode` | 1155 | `transform`, `w`, `h`, `children: NodeId[]`, `componentId?`, `layoutStyle?`, `variant?` |
| `'adjustment'` | `AdjustmentNode` | 1321 | `adjustmentType`, `params`, `scope?` |
| `'path'` | `PathNode` | 1347 | **Deprecated** — use ShapeNode |
| `'rasterLayer'` | `RasterLayerNode` | 1367 | `width`, `height`, `pixelMode`, `tiles: Map<string, RasterTile>` |

Container types: `FrameNode | GroupNode` — `isContainer()` at types.ts:1393.

Non-node document-level types: `Page` (types.ts:1512), `Spread` (types.ts:1585), `MasterPage` (types.ts:1553), `ComponentDefinition` (types.ts:1668), `Style` union (types.ts:1730).

### ID scheme

**File:** `packages/scene/src/node-id.ts`

Node IDs are **monotonically incrementing integers with an `n` prefix** (`nextNodeId()` in `packages/scene/src/node-id.ts:4`):
```
function nextNodeId(doc) → { id: `n${doc.nextId}`, doc: { ...doc, nextId: doc.nextId + 1 } }
```
The counter lives in `Document.nextId` and is atomically consumed on every node creation.

There is also an `IdGenerator` system (`packages/scene/src/ids.ts`) with labeled prefixes (`s` for style, `p` for page, `g` for guide, `col`/`v` for variables, `tl`/`trk`/`kf` for motion, `sm` for state machine, `sw`/`cs` for colors). However, the editor primarily uses `nextNodeId` for node creation.

**ID stability:**
- **Across sessions:** Stable — IDs and `nextId` counter are serialized in the JSON and restored on load.
- **Across copy/paste:** NOT stable — `deepCloneSubtree` (`clone.ts:36`) calls `nextNodeId` for every node, assigning fresh IDs.
- **Across undo/redo:** Stable — undo saves/restores full `Document` snapshots including all IDs.

**Document-level IDs** (`Document.id`, `Page.id`, `MasterPage.id`, `Spread.id`) use `crypto.randomUUID()` via `cryptoId()` (`document.ts:309`).

### Page/artboard/layer containment

**File:** `packages/scene/src/document.ts`

The document uses a **hybrid model**:
- `nodes: Record<NodeId, SceneNode>` — flat map of ALL nodes
- `rootChildren: NodeId[]` — ordered array of root-level nodes
- `pages?: Page[]` — each Page has a `contentRoot` pointing to a GroupNode that holds page content (`activePageNodes()` in `packages/scene/src/document-pages.ts:372`)
- `globalChildren?: NodeId[]` — nodes visible on ALL pages

Nodes are addressed **by flat ID lookup** only (O(1), `doc.nodes[id]`). There is no path-based addressing. Parent lookups use `getParent()` (`packages/scene/src/document-utils.ts:67`, O(n)) or `buildParentIndexMap()` (`packages/scene/src/document.ts:809`, cached O(1) map).

Tree walking: `walkNodes()` (`packages/scene/src/document.ts:783`) — DFS in paint order, returns `Map<NodeId, NodeEntry>` with parent info and depth.

### Serialization format

**File:** `packages/scene/src/documentCodec.ts`

**Format:** JSON. Custom MIME type `application/vnd.varve+json` for clipboard
(the legacy `application/vnd.strata+json` type is still read for
compatibility).

**Codec API:**
- `DocumentCodec.decode(json)` (documentCodec.ts:714) — parses, validates, runs migrations, normalizes, rehydrates assets, returns `DocumentDecodeResult`
- `DocumentCodec.encode(doc)` (documentCodec.ts:802) — normalizes, stamps version, strips redundant asset payloads, returns JSON string

**Schema version:** `CURRENT_DOCUMENT_VERSION = '2.14'` (`packages/scene/src/version.ts:6`)

**Supported versions:** 1.0 through 2.14 (`SUPPORTED_VERSIONS` in version.ts), plus implicit 0.9 base.

**Migrations:** Ordered array of `DocumentMigration` objects (version.ts), applied by `migrateDocumentDetailed()` (version.ts:1137). Each migration is a raw JSON transform function. Key migrations include 0.9→1.0 (canvas dimensions), 1.1→1.2 (page wrapping), 1.4→1.5 (ImageNode→ShapeNode), 2.0→2.1 (raster mask assets), 2.5→2.6 (external asset table).

**Post-migration rehydration:** `rehydrateEmbeddedAssetSrc()` (`packages/scene/src/version.ts:763`) restores `ImageFillData.src` from `Document.assets[assetId].dataUrl`.

**Serialize-time stripping:** `stripEmbeddedAssetPayloads()` (version.ts:830) drops per-fill `src` when it matches the canonical asset entry — bytes stored once instead of per-placement.

### Document-level metadata

**File:** `packages/scene/src/document.ts` (`Document` interface at line 139)

The `Document` interface carries all metadata as optional fields:

| Field | Type | Added |
|-------|------|-------|
| `paints?` | `Record<string, Paint>` | v1.8 |
| `styles?` | `Record<string, Style>` | v1.0 |
| `variableStore?` | `VariableStore` | v1.2 |
| `guides?` | `Guide[]` | v1.0 |
| `pages?` | `Page[]` | v1.2 |
| `stateMachines?` | `Record<string, StateMachine>` | v1.3 |
| `colorConfig?` | `ColorConfig` | v1.1 |
| `swatches?` | `ColorSwatch[]` | v1.1 |
| `timelines?` | `Record<string, Timeline>` | v1.2 |
| `interactions?` | `Record<NodeId, DocumentInteraction[]>` | v1.6 |
| `textChains?` | `Record<string, TextChain>` | v1.7 |
| `brushPresets?` | `Record<string, BrushPreset>` | v1.10 |
| `masters?` | `Record<NodeId, MasterPage>` | v2.0 |
| `spreads?` | `Spread[]` | v2.0 |
| `sections?` | `PageSection[]` | v2.0 |
| `assets?` | `Record<string, DocumentAsset>` | v2.6 |
| `linterConfig?` | `LinterConfig` | v2.7 |

Precedent for storing arrays: `pages: Page[]`, `guides: Guide[]`, `swatches: ColorSwatch[]`, `spreads: Spread[]`, `sections: PageSection[]`.

There is also `DocumentBase` (`types.ts:1061-1072`) — a minimal subset shared across modules to avoid import cycles with the full `Document` type.

#### Risks and unknowns

- **No path-based addressing** — anything that needs a stable global reference to a node (e.g., cross-document hyperlinks) must use NodeId, which changes on paste. There is no stable "deep path" like `/page-2/artboard-1/layer-3`.
- **Monotonic `n`-prefixed IDs** mean that on document load, `nextId` is clamped to `maxNumericNodeId(nodes) + 1` (codec:554) — safe, but means IDs are deterministic within a session and collision-free between sessions only by luck.
- **Two ID systems coexist** — `nextNodeId()` monotonic counter (used for nodes) and `IdGenerator` with labeled prefixes (used for styles/pages/variables/motion). The `IdGenerator` pattern is NOT used for nodes but the infrastructure exists.
- **Migrations mutate raw JSON** — they operate on `Record<string, unknown>` before any type validation. A typo in a migration silently drops fields.
- **`DocumentBase` duplicates the interface shape** — if new fields are added to `Document`, they must be manually mirrored in `DocumentBase` or import cycles appear.

---

## 2. TRANSACTION / UNDO SYSTEM

### Core hook: `useHistory()`

**File:** `packages/editor/src/context/useHistory.ts` (all 158 lines)

Pure `useRef`-based stacks — avoids re-renders on every undo push.

| Method | Line | Purpose |
|--------|------|---------|
| `pushUndo(doc, selection)` | 25 | Push snapshot, clear redo stack |
| `pushUndoIfNotTransaction(doc, selection)` | 32 | Push only if NOT inside a transaction |
| `undo(currentDoc, currentSel, patch)` | 41 | Pop undo → redo, patch state |
| `redo(currentDoc, currentSel, patch)` | 57 | Pop redo → undo, patch state |
| `beginTransaction(currentDoc, currentSel)` | 73 | Set flag, capture snapshot |
| `commitTransaction(patch)` | 80 | End tx, push captured snapshot to undo |
| `abortTransaction(patch)` | 101 | End tx, restore captured snapshot |
| `isInTransaction()` | 113 | Boolean |
| `save()` / `restore()` | 115/125 | Serialize/deserialize for tab switching |
| `reset()` | 132 | Clear all stacks |

Max entries: **50** (`MAX_UNDO = 50` at line 13).

### Transaction coalescing

**Yes, multiple mutations can be coalesced into a single undo step.**

Lifecycle:
1. `beginTransaction()` — captures current doc as `txSnapshotRef`
2. Zero or more `updateDoc(fn)` calls — each would call `pushUndoIfNotTransaction`, which SKIPS because `inTransactionRef.current === true`
3. `commitTransaction()` — pushes the BEGINNING snapshot to undo stack → single undo entry for all mutations
4. `abortTransaction()` — restores the beginning snapshot via `patch()`, reverting all intermediate mutations

**Evidence in production:**
- `AdjustmentPanel.tsx:107` — slider scrub: beginTransaction on pointerdown, commitTransaction on pointerup. Test at `AdjustmentPanel.test.tsx:162` confirms "coalesces a slider scrub into one undo operation".
- `SelectTool.ts:399` — keyboard nudge: "Key-repeat coalescing: only begin a transaction on the first press."

### Patch-based vs imperative

**Purely snapshot-based (full document replacement).** No immer, no JSON Patch, no command pattern.

`updateDoc()` (`context.tsx:2202-2218`):
```ts
const updateDoc = useCallback((fn: (doc: Document) => Document) => {
  setState((s) => {
    history.pushUndoIfNotTransaction(s.document, s.selection);
    const newDoc = fn(s.document);
    return { ...s, document: newDoc, dirty: true, ... };
  });
}, [history]);
```

The function receives the current `Document` and returns a new one. No reverse-computation — undo simply pops the previous full snapshot. No diffs are stored.

### Preview / inspection

**No dry-run capability exists.** `isInTransaction()` returns only a boolean. The snapshot is held in `txSnapshotRef` (a ref, not exposed).

**Related but separate:**
- `FixPreviewManager` (`packages/scene/src/intelligence/fixPreview.ts:1-299`) — deep clones the document via `JSON.parse(JSON.stringify(document))`, applies a fix to the clone, returns the result. This is in the audit system, NOT the transaction system.
- Since mutations are pure functions `(doc: Document) => Document`, you COULD call `fn(s.document)` and inspect the result without pushing to history. But there is no built-in utility for this.

### Undo labels

**No dynamic labels.** The UI always shows static "Undo" and "Redo":
- `Menubar.tsx:213-224`: `{ label: 'Undo', shortcut: 'Ctrl+Z', action: 'undo' }`
- `Menubar.tsx:1558-1559`: IconButton with `label="Undo"`
- `ShortcutManager.ts:6-7`: `undo: { binding: { key: 'z', ctrl: true }, label: 'Undo' }`

No label/description field on the `SavedHistory` interface or `TransactionHooks`. No `canUndo`/`canRedo` reactive state is exposed.

### History on state transitions

| Transition | Effect | File:Line |
|-----------|--------|-----------|
| New tab | Save current session, clear all stacks | `context.tsx:6189-6192` |
| Switch tab | Save current, restore target's stacks from `sessionStoreRef` | `context.tsx:6233-6236` |
| Close tab | Save current, restore adjacent tab's stacks | `context.tsx:7161-7164` |
| New document | Reset all stacks | `usePersistence.ts:38` |
| Load document | Reset all stacks | `usePersistence.ts:94` |
| Open file (new) | Clear all stacks | `context.tsx:6319-6322` |
| Open file (existing tab) | Switch to that tab, restore saved stacks | `context.tsx:6298-6315` |
| **Workspace mode switch** | **No effect on history** | `context.tsx:2553-2572` |
| Document save | No effect — only patches `dirty`, `saveState` | `usePersistence.ts:46-78` |

**Per-tab undo isolation:** Each tab has its own independent history, preserved in `sessionStoreRef` (`context.tsx:1394-1402`).

**Version History** (`VersionHistoryService.ts`) is a separate durably-stored system using content-addressed storage on the Platform facade — completely independent of in-memory undo/redo.

#### Risks and unknowns

- **Storing full `Document` snapshots in undo/redo stacks is memory-intensive** — every mutation duplicates the entire document tree. With 50 entries and large documents, this could consume hundreds of MB. No structural sharing (immer-style) is used.
- **No `canUndo`/`canRedo` reactive state** — the stack lengths are in refs, not state. Menu items cannot show disabled state for undo/redo without a workaround.
- **No undo label system** — the "Undo" menu item is always generic. Adding labels would require a schema change to `SavedHistory` and a new field on undo stack entries.
- **Transaction API is NOT the only mutation path** — some operations (`createShapeAt`, `createTextNodeAt`, `applyFramePreset` at context.tsx:2796, 2976, 3052) push directly to `undoStackRef` without using beginTransaction/commitTransaction.
- **AbortTransaction restores the entire document snapshot** — there's no way to preview what abort would do before calling it.

---

## 3. MENU SYSTEM

### Menu model

**Hybrid declarative/imperative:** The `Menubar` uses a declarative config array (`MenuItem[]`). Context menus use both the shared declarative `Menu` component and imperative hand-authored JSX.

**Menubar:** `packages/editor/src/Menubar.tsx`
- `buildMenus()` (Menubar.tsx:120) returns `{ id: MenuId; items: MenuItem[] }[]`
- `MenuItem` interface (`packages/editor/src/menu/types.ts:82`): `{ label, shortcut?, action?, disabled?, ariaKeyshortcut? }`
- Rendered from config in `Menubar` body
- Wrapped in `useMemo` with dependency array of individual state fields

**Shared UI `Menu` component:** `packages/ui/src/components/Menu.tsx`
- `Menu` (Menu.tsx:675) takes `items: readonly MenuEntry[]` (data-driven)
- `ContextMenu` — same model, absolute positioned
- `MenuEntry` union (Menu.tsx:71): `MenuItem | MenuSeparator | MenuItemCheckbox | MenuItemRadio | SubmenuItem`
- Submenus are declarative via `SubmenuItem` (Menu.tsx:62): `{ type: 'submenu', submenu: readonly MenuEntry[] }`

**Context menus — various patterns:**
- Shell canvas context menu (`Shell.tsx:682-796`): Imperative `MenuEntry[]` array, passed to `<ContextMenu>`
- Guide context menu (`GuideContextMenu.tsx:15-48`): Small `MenuEntry[]` array, passed to `<ContextMenu>`
- LayersPanel context menu (`LayersPanel/index.tsx:420-594`): **Fully imperative JSX** — hand-authored `<button>` elements with `role="menuitem"`, NOT using the shared `ContextMenu` component. Custom `ContextMenuItem` sub-component at lines 603-624.
- `FloatingToolbar.tsx:300-320, 406-417`: Declarative `MenuEntry[]` arrays, passed to `<ContextMenu>`

### Enabled/disabled/checked state

Computed **per-render** via pure function calls during render. No subscription-based update model.

- `buildMenus()` uses `dis()` helper (Menubar.tsx:77-129) — a switch statement mapping action IDs to disabled predicates
- Inline boolean checks: `disabled: state.workspaceMode === 'design'` (line 535), `disabled: state.rulerMode === 'artboard'` (line 456)
- `itemAriaChecked()` (lines 943-969): computes `aria-checked` for radio/checkbox items
- Checkbox state in shared `Menu` is passed as a simple `checked` boolean in `MenuItemCheckbox` (line 33)
- LayersPanel context menu: disabled computed via inline expressions (e.g., `disabled={!canGroup}` at line 456), no useMemo

### Keyboard navigation

**Menubar top-level** (`Menubar.tsx:1285-1391`):
| Key | Action |
|-----|--------|
| `ArrowLeft`/`ArrowUp` | Previous menu button |
| `ArrowRight`/`ArrowDown` | Next menu button |
| `Enter`/`Space` | Open dropdown |
| `Home` | First button |
| `End` | Last button |

**Menubar dropdown** (`Menubar.tsx:1289-1348`):
| Key | Action |
|-----|--------|
| `ArrowDown`/`ArrowUp` | Navigate items (wrap) |
| `Enter`/`Space` | Activate |
| `Escape` | Close, return focus to trigger |
| `ArrowLeft`/`ArrowRight` | Switch to prev/next menu |
| `Home`/`End` | Jump first/last |

**Shared UI `MenuInternal`** (`Menu.tsx:186`):
All of the above plus: `Tab` closes the tree and walks global tab order (`handleTopTab`, Menu.tsx:232), **type-ahead** (Menu.tsx:336) matches letter keys against item labels with a 500ms reset timer.

**NOT supported:** Mnemonics (Alt+F, etc.). No `accesskey` attributes anywhere.

**LayersPanel context menu:** Only `Escape` is handled (line 428). No Arrow/Home/End navigation.

### Accelerator representation

**File:** `packages/editor/src/shortcuts/types.ts` (lines 1-6):
```ts
interface ShortcutBinding { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; }
```

**Shortcut definitions:** `packages/editor/src/shortcuts/ShortcutManager.ts` — `SHORTCUT_DEFS: Record<string, ShortcutDef>` with `binding`, `label`, `category`, optional `platform`, optional `context`.

**Platform mapping:**
- `isMac()` at line 747: `navigator.platform?.toLowerCase().includes('mac')`
- `captureKeyCombo()` at line 696: Maps `Ctrl` on non-Mac, `Cmd (Meta)` on Mac: `ctrl: isMac() ? e.metaKey : e.ctrlKey`
- `formatShortcut()` at lines 847-868: Mac renders Unicode symbols (`\u2318` Cmd, `\u21E7` Shift, `\u2325` Alt); non-Mac renders `Ctrl+`, `Shift+`, `Alt+`.

**Override system:** `setOverride()`, `clearOverride()`, `getEffectiveBinding()` — user-remapped shortcuts stored in `localStorage`.

### Tauri native menus

**None.** All menus are custom React DOM components using `FloatingPortal`. No Tauri `MenuBuilder`, `Submenu`, or `MenuEvent` usage anywhere.

#### Risks and unknowns

- **LayersPanel context menu is a different pattern** — it doesn't use the shared `ContextMenu` component. This means keyboard navigation (arrows, type-ahead) and accessibility patterns (roving tabindex, aria-activedescendant) must be re-implemented or will be missing.
- **No mnemonic support** — Alt+letter shortcuts don't work. This is a WCAG 2.1 failure for keyboard users who rely on them.
- **State is re-computed every render** — no memoization of menu item state (beyond the top-level `useMemo` on `buildMenus`). If menu state computation becomes expensive (e.g., scanning the document for an enabled/disabled check), it could cause frame drops.
- **`buildMenus()` dependency array already has 25+ fields** (line 1021-1038). Adding more state to the menu model inflates this further and risks missed dependencies.
- **No `canUndo`/`canRedo` state** — undo/redo menu items can never be disabled.

---

## 4. WORKSPACE MODE

### Type definition

**File:** `packages/editor/src/workspace/workspaceTypes.ts` (line 25):
```ts
export type WorkspaceMode = 'design' | 'print' | 'drawing' | 'image' | 'motion' | 'codegen';
```

### EVERY caller of `setWorkspaceMode`

1. **`context.tsx:2553-2572`** — Implementation inside `EditorProvider`. Patches `workspaceMode`, panel visibility, default tool, persists to settings, announces for screen readers.
2. **`Menubar.tsx:1543`** — Inline radio button group `<input type="radio" onChange={() => setWorkspaceMode(mode)}>`. Hardcodes 5 modes: `['design', 'print', 'drawing', 'image', 'motion']` — notably excludes `'codegen'`.
3. **`createActionHandlers.ts:110-114`** — Command palette / keyboard actions: `workspaceDesign`, `workspacePrint`, `workspaceDrawing`, `workspaceImage`, `workspaceMotion`.
4. **`useShortcuts.ts:63`** — Direct shortcut dispatch for `'motionWorkspace'` action ID.
5. **`WorkspaceSwitcher.tsx:70-84`** — UI button click → `useWorkspaceSwitcher().switchMode()` → `setWorkspaceMode()`.
6. **`AiToolsHintSection.tsx:30`** — "Switch to Photo mode" button → `switchMode(...)` → `setWorkspaceMode('image')`.

### Guards: `useWorkspaceSwitcher()`

**File:** `packages/editor/src/workspace/useWorkspace.ts`

**`detectInteractionState()`** (line 25-41) — checks four conditions:

| Guard | Check | Line |
|-------|-------|------|
| Modal open | `state.prototypeMode \|\| state.isPresenting` | 29 |
| Text editing | `state.tool === 'nodeEdit'` | 32 |
| Cropping | `state.tool === 'crop'` | 35 |
| Mask editing | `state.maskPreviewMode !== 'none'` | 38 |

**There is no check for** in-progress drag, pointer interaction, or tool interaction (like drawing a shape). Only tool *state*, not tool *activity*.

**`resolveInteraction()`** (line 44-64):
- For `'editing-text'`, `'cropping'`, `'mask-editing'`: sets tool to `'select'`
- For `'modal-open'`: **no-op** ("Don't force-close modals")
- For `'idle'`: no-op

**Re-entrancy guard:** `inProgressRef` (line 98-99, 103) — `useRef(false)`, set true in entry, false in `finally`.

**No-op guard:** (line 104) — skips if `nextMode === ctx.state.workspaceMode`.

### Sync vs async

**Entirely synchronous.** No confirmation dialog, no async/promise path, no user prompt. The entire guard+resolve+switch pipeline completes in one call frame.

### Parallel type definitions (divergence risk)

| File | Line | Missing |
|------|------|---------|
| `packages/editor/src/workspace/workspaceTypes.ts` | 25 | (canonical — all 6) |
| `packages/platform/src/types.ts` | 20 | (renamed `EditorWorkspaceMode`, all 6 values) |
| `packages/scene/src/auditFinding.ts` | 56 | **Missing `'codegen'`** |
| `packages/shared/src/auditTypes.ts` | 83 | **Missing `'codegen'`**, different order |

#### Risks and unknowns

- **`codegen` mode is excluded from the menubar radio buttons** — users cannot switch to Codegen & Audit mode via the menubar (only via WorkspaceSwitcher panel or command palette).
- **Guards don't detect in-progress pointer interactions** — a user mid-drag in the drawing tool can switch modes, potentially leaving dangling interaction state.
- **`detectInteractionState` misses several interaction states** — polygon drawing (ClickTool accumulating points), brush strokes, marquee selection. These should be resolved before a mode switch.
- **Three parallel `WorkspaceMode` type definitions** — two are missing `'codegen'`. A new mode added to one must be propagated to all four.

---

## 5. INTELLIGENCE / AUDIT ENGINE

### Two parallel systems (architectural duplication)

There are **two separate rule registration systems** and **two incompatible `AuditFinding` types**:

#### A. Primary audit engine: `packages/scene/src/auditEngine.ts`

Rule registration: module-level `Map<string, AuditRuleDef>`:
- `registerRule(rule: AuditRuleDef): void` (line 182)
- `getRule(id)`, `getAllRules()`, `getRules(filter)`, `clearRules()`, `ruleCount()`

`AuditRuleDef` interface (line 74-127):
```ts
{ id, label, category, source, defaultSeverity, cost, stage, workspaces, nodeKinds,
  blocking, contextDependent, confidenceFloor, suppressible, ruleVersion,
  discriminator, run: (ctx: AuditContext) => AuditFinding[] }
```

Execution stages (line 40-44): `'immediate'` (<50ms), `'debounced'` (300ms), `'on-demand'`, `'preflight'`.

Caching: `scanCache` (line 259) keyed by `ruleId:docRevision:selectionKey`, 5-second TTL. Cache invalidation via `invalidateCache()` (line 298) and `invalidateNodes()` (line 309).

#### B. Secondary: `packages/editor/src/intelligence/registry.ts`

Separate `Map<string, IntelligenceFeature>` for editor-side intelligence features. See `registerFeature()` (line 23), `getAllFeatures()` (line 31).

### Built-in rules (27 total)

**File:** `packages/scene/src/auditAdapter.ts`

Created by `createBuiltinRules()` which composes from three sources:

1. **WCAG Text Contrast** (line 46-79): 1 rule — `contrast/aa-fail`, cost: `moderate`, stage: `debounced`
2. **Debt Scanner** (line 92-249): 15 rules — `debt/*` covering colors, spacing, naming, orphan styles, unused components, missing fonts, duplicate styles, inconsistent radius, hardcoded font sizes, mixed color spaces, low contrast, overset text, unnamed layers, excessive nesting, missing export presets
3. **Linter Rules** (line 252-308): 6 rules — `linter/zero-size`, `off-canvas`, `empty-container`, `non-text-contrast`, `touch-target`, `focus-order`
4. **Governance Rules** (line 311-365): 5 rules — `governance/*` for token colors, spacing tokens, naming, orphan, font

### CRITICAL: `registerBuiltinRules()` is defined but NEVER CALLED

The function is exported from `auditAdapter.ts:382` and re-exported from `packages/scene/src/index.ts:12`, but **no file in the entire codebase actually calls it**. The `runAudit()` call in `IntelligencePanel.tsx:622` would produce empty results because the registry has zero rules.

### componentVariantDetector and shortcutRecommender

These are **NOT registered as audit rules** — they are standalone pure functions called directly by UI:

- `componentVariantDetector.ts` (`packages/editor/src/intelligence/componentVariantDetector.ts:113-179`): returns `VariantCandidate[]` — called by `variantGenerator.ts`
- `shortcutRecommender.ts` (`packages/editor/src/intelligence/shortcutRecommender.ts:27-69`): returns `ShortcutRecommendation[]` — based on `ActionTracker` usage data
- `componentDetector.ts` (`packages/editor/src/intelligence/componentDetector.ts:116-154`): returns `DuplicateGroup[]` for `findDuplicateStructures()` — used by `ComponentsTab` in IntelligencePanel

### The Finding type — TWO versions

**Version A (canonical, used by engine):** `packages/scene/src/auditFinding.ts:119-171`:
```ts
{ ruleId, ruleVersion, findingId, fingerprint, category, severity, confidence (0-1),
  message, messageKey, messageParams, detail, nodeId?: NodeId, pageId?, evidence?,
  recommendation?, autoFixAvailable, fixes?, source, cost, contextDependent,
  workspaceApplicable, blocking, revision?, generatedAt }
```

**Version B (shared, used by scheduler/overlay):** `packages/shared/src/auditTypes.ts:203-330`:
- Uses `nodeIds: NodeId[]` (plural array) instead of `nodeId?: NodeId`
- Has `region?`, `interactionId?`, `targetName?`
- Uses `fixCapability: FixCapability` (enum) instead of `autoFixAvailable: boolean`
- Uses `suppressionEligible`, `suppressionScope`, `suppression?`
- Has `documentRevision: number`, `stale: boolean`, `resolved: boolean`

**Finding ID generation** (`auditFinding.ts:198-206`): FNV-1a-like hash of `${ruleId}::${nodeId ?? ''}`, base-36 encoded.

**Fingerprint** (`fingerprint.ts:143-156`): 128-bit FNV-1a hash from `ruleId + ruleVersion + subject + discriminator`. Subjects: `node`, `nodePair`, `nodeSet`, `document`, `page`. Fingerprints survive re-scans and sessions.

### Scan scheduling

**Two separate scheduling systems (another duplication):**

1. **`auditEngine.ts:420`** — `runAudit()`: synchronous, filters rules, sorts by cost, runs sequentially, cache-aware. `runQuickStatus()` at line 475: only cheap + immediate, <20ms budget.

2. **`auditScheduler.ts:127`** — `AuditScheduler` class: separate debounce timers (50ms immediate, 300ms debounced), rapid edit detection (>10 edits/sec pauses audit), 5-minute periodic interval, `executePlan()`, `runOnDemand()`, `runPreflight()`. **Not wired to the engine in production.**

**Trigger points in the editor:**
- `IntelligencePanel.tsx:598-641` — `runReview()` calls `runAudit(ctx)` synchronously with 50ms `setTimeout` delay. Triggered via `requestIdleCallback({timeout: 1000})` on mount.
- `IntelligencePanel.tsx:234-253` — `runScan()` for linter tab, runs on mount
- `IntelligencePanel.tsx:885-932` — AuditTab uses `useMemo(() => runIntelligenceAudit(state.document), [state.document])` — runs on every render where document changed
- `AuditBadge.tsx:42-73` — `runQuickScan()` calls `runQuickStatus(ctx)`, triggered via `requestIdleCallback({timeout: 500})` on mount

### Results display

**Five UI surfaces:**
1. **IntelligencePanel** (`packages/editor/src/panels/IntelligencePanel.tsx`): 11 tabs (Review, Audit, Linter, Components, Spacing, Naming, Governance, Debt, Prototype, Layout, Similar). Review tab at line 586-879: summary bar, category filter chips, grouped collapsible sections, auto-fix/suppress buttons.
2. **AuditBadge** (`packages/editor/src/components/AuditBadge.tsx`): L1 status bar indicator (line 96-111). Uses `runQuickStatus()`.
3. **AuditPanel** (`packages/editor/src/components/Inspector/panels/AuditPanel.tsx`): Inspector panel bridge, adds `AdaptiveContrastSection` and `CognitiveLoadIndicator`.
4. **ContextualAuditSummary** (`packages/editor/src/components/ContextualAuditSummary.tsx`): Inline finding chips near property controls, up to 3 + "+N more".
5. **AuditUtilityPanel** (`packages/editor/src/panels/AuditUtilityPanel.tsx`): Standalone floating panel **not currently wired into the editor**.

**Canvas overlays** (`packages/scene/src/intelligence/overlayManager.ts`): `OverlayManager` class supports `highlight`, `outline`, `badge`, `arrow`, `region` types — **not yet wired into the canvas rendering pipeline**.

### Suppression system

**File:** `packages/scene/src/auditSuppression.ts`

- `SuppressionEntry` type with `fingerprint`, `ruleId`, `reason`, `suppressedAt`, `expiresAt?`
- `suppressFinding()`, `isSuppressed()`, `getSuppressions()`, `clearExpiredSuppressions()`
- Suppressions stored in the `Document` object — there is no separate suppression store

#### Risks and unknowns

- **`registerBuiltinRules()` is never called** — the entire audit engine rule registry is empty in production. `runAudit()` produces zero findings. Fix: call `registerBuiltinRules()` once on editor startup (documented in the comment at `auditAdapter.ts:380-381`).
- **Two incompatible `AuditFinding` types** — code that imports from `@varve/shared`'s version (with `nodeIds: NodeId[]`) cannot work with code that imports from `@varve/scene`'s version (with `nodeId?: NodeId`) without a mapping layer.
- **Two separate scheduling systems** — `auditEngine.ts:runAudit()` (sync, with caching) and `auditScheduler.ts:AuditScheduler` (async, with debounce timers). The scheduler is not wired to the engine. A new feature should extend one, not both.
- **Editor intelligence modules bypass the rule registry entirely** — `componentVariantDetector`, `shortcutRecommender`, `componentDetector` are standalone functions called directly by UI. They don't benefit from caching, suppression, scheduling, or the Finding type system.
- **Suppressions are stored in the `Document`** — serialized/versioned with the doc. No separate store. No concept of "workspace-wide" vs "document-wide" suppressions yet.

---

## 6. CANVAS RENDERER

### Render loop

**File:** `packages/editor/src/performance/frameScheduler.ts`

Four-priority-lane frame scheduler:
- `'input'`, `'canvas'`, `'ui'`, `'background'` (lines 9, 44)
- `createFrameScheduler()` (line 46-170) — keyed latest-wins queue per lane, executed in order each RAF tick

**File:** `packages/editor/src/performance/editorFrameRuntime.ts`
- `requestEditorFrame(key, lane, job)` (line 36-38) — singleton scheduler using `window.requestAnimationFrame`

**CanvasArea** (`packages/editor/src/CanvasArea.tsx`) registers two persistent draw jobs:
- `drawContent()` (line 1258) — lane `'canvas'`. Builds IR, applies camera, paints via `replayIr()`. Supports culling, sub-tree IR cache (`SubtreeIrCache`), partial redraw (dirty rect < 60% → clip).
- `drawOverlay()` (line 2488) — lane `'ui'`. Renders draft shapes, mask preview overlays.

**Invalidation:**
- `computeDocumentDirtyRegion()` (`canvas/dirtyRegion.ts:48`) — diffs two Document objects: returns `'none'` | `'full'` | `'partial' { bounds: Rect }`
- `computeInvalidationPlan()` (`canvas/invalidationPlan.ts:22`) — decides if cache wipe is needed

### Overlay/decoration layers

**CSS stacking order (`editor.css:498-557`):**

| z-index | Layer | Type |
|---------|-------|------|
| 0 | `.editor-canvas__grid-layer` | CSS dot grid |
| 1 | `.editor-canvas__pixel-grid` | CSS pixel grid |
| 2 | `.editor-canvas__content-layer` | Canvas — scene via `replayIr` |
| 3 | `.editor-canvas__overlay-layer` | Canvas — draft shapes, mask preview |
| 4 | `.editor-canvas__color-blindness` | Canvas — color blindness sim |
| 9 | `.ruler-container` | Two `<canvas>` |
| 10 | Interactive overlays (SVG/HTML) | See below |
| 100 | Zoom indicator | CSS |

**Orchestrator:** `packages/editor/src/components/CanvasOverlays.tsx` (line 110)

| Overlay | File | Space | Notes |
|---------|------|-------|-------|
| **SelectionOverlay** | `SelectionOverlay.tsx` | Screen (`simpleWorldToScreen`) | 8 resize handles + rotation, oriented bounding box |
| **SnapGuidesOverlay** | `SnapGuidesOverlay.tsx` | Screen | Colored snap lines with labels |
| **GuideOverlay** | `GuideOverlay/GuideOverlay.tsx` | Screen | Interactive ruler guides, drag/hit/context-menu |
| **Ruler** | `Ruler/Ruler.tsx` | Screen, 2x `<canvas>` | Projects world ticks via `projectWorldXToTopEdge` |
| **CanvasNameLabels** | `canvas/CanvasNameLabels.tsx` | Screen (`editorWorldToScreen`) | Figma-style frame name tags |
| **NodeEditOverlay** | `NodeEditOverlay.tsx` | World | Path anchor editing |
| **GradientHandleOverlay** | `GradientHandleOverlay.tsx` | World | Gradient stop editing |
| **MeshWarpOverlay** | `MeshWarpOverlay.tsx` | World | Mesh warp control points |
| **CropOverlay** | `CropOverlay.tsx` | Screen (`editor.worldToCanvas`) | Crop window + handles |
| **MotionPathOverlay** | `MotionPathOverlay.tsx` | Screen (`worldToCanvas`) | Animation motion paths |
| **OnionSkinOverlay** | `OnionSkinOverlay.tsx` | Canvas | Ghosted animation frames |
| **CollabCursorOverlay** | `CollabCursorOverlay/` | Screen (`worldToScreen`) | Remote collaborator cursors |
| **ColorBlindnessOverlay** | `ColorBlindnessOverlay.tsx` | Canvas (z=4) | Copies content canvas, CSS filter |
| **DocumentGridOverlay** | `DocumentGridOverlay/` | Screen | Baseline/isometric guides |
| **AlignmentGuideOverlay** | `AlignmentOverlay.tsx` | Screen | Alignment lines during drag |

**Coordinate space split:**
- **Canvas layers (content + overlay):** Camera transform applied via `applyEditorCameraToCtx` — shapes drawn in **world coordinates**, canvas CTM handles zoom/pan/rotation/DPR.
- **SVG/HTML overlays (z=10):** Work in **screen/CSS pixels**. Convert world→screen via `simpleWorldToScreen()` (no rotation) or `editorWorldToScreen()` (with rotation).
- **Ruler canvases (z=9):** Project world coordinates onto edge via `projectWorldXToTopEdge()` / `projectWorldYToLeftEdge()`.

### Document-to-screen transform

**Core math:** `packages/shared/src/viewport.ts` (line 12):
```
screen = T(pan) · T(vpCentre) · R(θ) · T(−vpCentre) · S(zoom) · world
```

Key functions:
- `worldToScreen()` (line 140) — world → CSS px with rotation
- `screenToWorld()` (line 127) — CSS px → world
- `simpleWorldToScreen()` (line 172) — no rotation: `[wx*zoom+pan.x, wy*zoom+pan.y]`
- `applyCameraTransform()` (line 196) — sets Canvas2D CTM with DPR/zoom/pan/rotation

Editor wrappers:
- `editorScreenToWorld()` / `editorWorldToScreen()` — `cameraState.ts:39, 50` — adds floating origin
- `applyEditorCameraToCtx()` — `cameraState.ts:98` — applies to canvas context
- Exposed as `editor.worldToCanvas()` / `editor.canvasToWorld()` — `context.tsx:3127, 3114`

**Nested (scene-graph) transforms:** `packages/scene/src/coordinateService.ts`
- `nodeWorldTransform()` (line 56) — walks parent chain, composes local→parent affines
- `nodeWorldBounds()` (line 125) — world-space AABB
- `localToWorld()` / `worldToLocal()` (lines 145, 159)
- Artboard-aware: `isArtboard()` (line 258), `artboardLocalToWorld()` (line 330)

**Caching:** `editor/scene/transformCache.ts` — full cache clear on structural changes, subtree invalidation on edits.

### Hit-testing utilities

**`HitTestEngine`:** `packages/editor/src/hitTest/HitTestEngine.ts`:
- `hitTest(world: {x,y})` (line 75) — returns topmost node
- `findNodesAtPoint(world)` (line 193) — all hit nodes in paint order

How it works:
1. **Spatial index pre-filter** (line 305-323): grid-based (CELL_SIZE=64 world units), queries cell + neighbors within `toleranceWorld` — O(1) candidate lookup
2. **Paint-order traversal** (line 81-84): DFS reverse for topmost-first
3. **Per-type hit tests:** shapes use `shapeContains()` with inverted world transform; text/frame use AABB; groups test children individually
4. **Visibility checks** (line 331-374): respects locked, visible, isolation mode, clip mask occlusion
5. **Zoom-aware tolerance** (line 66): `8px / zoom`

**Exposed on editor context** (`context.tsx:3154`):
```ts
hitTestNode: (world) => { engine = new HitTestEngine(...); return engine.hitTest(world); }
```

**Spatial index:** `packages/editor/src/scene/spatialIndex.ts` — `buildSpatialIndex()` (line 73), `queryPoint()` (line 109), `queryRect()` (line 118). Frame-specific: `buildFrameSpatialIndex()` (line 144) with fingerprint-based invalidation.

#### Risks and unknowns

- **HitTestEngine is reconstructed per hit test** — `context.tsx:3154` creates a `new HitTestEngine(...)` on every pointer event. The spatial index is rebuilt if the document changed. For rapid pointer moves (e.g., drag), this means O(n) tree traversal per frame.
- **Partial redraw in `drawContent()`** — when dirty rect < 60% viewport, the canvas clips to the dirty rect (line 1608-1637). This optimization assumes the dirty region is accurate. An incorrect dirty region produces visual artifacts.
- **SVG overlays compute world→screen per frame** — every overlay converts coordinates independently. For 100+ visible frames, SelectionOverlay and CanvasNameLabels could recompute transforms hundreds of times per frame.
- **The two canvas layers (content + overlay) are separate `<canvas>` elements** — they cannot share GPU state. WebGPU would need to manage two swap chains.
- **No audit/intelligence overlay is wired to the canvas** — the `OverlayManager` exists but findings are only shown in panels, not on the canvas.

---

## 7. PLATFORM

### Tauri vs browser detection

**Canonical detection:** `packages/platform/src/detect.ts`:
- `detectPlatformKind()` (line 19-31): checks `window.__TAURI__` → `'tauri'`; `typeof indexedDB !== 'undefined'` → `'web'`; else → `'memory'`
- `detectPlatform()` (line 38-46): sync, returns Tauri platform or memory platform. **Does NOT return web platform** — web is async (IndexedDB) and must be explicitly constructed via `createWebPlatform()`.

**Duplicated `isTauriRuntime()` helpers** — nine independent modules reimplement the same `__TAURI__` sniff:

| File | Function |
|------|----------|
| `packages/editor/src/shortcuts/reservedShortcuts.ts:30-31` | `isTauriRuntime()` |
| `packages/engine/src/backgroundRemoval/providers/tauriProvider.ts:15-16` | `isTauriRuntime()` |
| `packages/engine/src/backgroundRemoval/environmentCapabilities.ts:47-48` | `detectTauri()` |
| `packages/engine/src/upscaleProviders/nativeProvider.ts:6-7` | `isTauri()` |
| `packages/engine/src/denoiseProviders/nativeProvider.ts:10-11` | `isTauriRuntime()` |
| `packages/print/src/native.ts:13-19` | `getCore()` guard |
| `packages/print/src/index.ts:39` | inline check |
| `packages/editor/src/backupService.ts:114` | inline check |
| `packages/engine/src/engine.ts:312-313` | inline check |

All check `typeof window !== 'undefined' && '__TAURI__' in window`.

### Features that silently no-op in browser

| Feature | File | Lines | Browser behavior |
|---------|------|-------|------------------|
| `revealInFileManager()` | `platform/src/web.ts` | 1154-1156 | Empty body |
| `listPrinters()` | `platform/src/web.ts` | 1111-1112 | Returns `[]` |
| `printPdf()` | `platform/src/web.ts` | 1114-1126 | Opens PDF in new tab |
| `cancelPrintJob()` | `platform/src/web.ts` | 1127-1128 | Returns error string |
| `onNativeFileDrop()` | `platform/src/web.ts` | 1131-1132 | No-op cleanup fn |
| `listenForChanges()` | `platform/src/web.ts` | 954-956 | No-op cleanup fn |
| `fileExists()` | `platform/src/web.ts` | 958-959 | Always `true` |
| `readClipboardImage()` | `platform/src/web.ts` | 1139-1151 | Uses Web Clipboard API fallback |
| Native AI providers | `engine/src/*` | various | `isAvailable()` returns `false` or throws |
| Print engine | `packages/print/src/index.ts` | 38-46 | Falls back to stub (placeholder results) |
| PDF export | `editor/AssetExportControls.tsx` | 30-31, 101-104 | Disabled with "Requires desktop app" tooltip |
| Splash screen | `desktop/startup/revealMainWindow.ts` | 17 | No-op |

### File operations in browser

**File:** `packages/platform/src/web.ts`

**Tier 1: File System Access API (Chromium):**
- Open (line 1007-1018): `showOpenFilePicker()` → `FileSystemFileHandle.getFile()` → `file.text()`
- Save (line 1045-1063): `showSaveFilePicker()` → `handle.createWritable()` → `writable.write()` → `writable.close()`

**Tier 2: Fallback (Firefox, Safari):**
- Open (line 1261-1298): `pickViaInput()` — creates hidden `<input type="file">`, clicks it, reads on change
- Save (line 1065-1073): Creates `Blob` → `URL.createObjectURL(blob)` → `<a download>` → `a.click()` → `URL.revokeObjectURL()`

**Tauri desktop** uses native dialogs via IPC (`platform/src/tauri.ts:502-568`).

### Platform abstraction package

**Location:** `packages/platform/` (not under `packages/@varve/`)
**npm name:** `@varve/platform`
**Architecture:** Hexagonal (ports & adapters):
- `Platform` interface (port) — `platform.ts`
- Three adapters: `web.ts`, `tauri.ts`, `memory.ts`
- `detectPlatform()` returns Tauri or Memory (web is async, must be constructed explicitly)

**Wiring in desktop:** `apps/desktop/src/App.tsx:9`: `const platform = detectPlatform()` — module-level singleton, passed as prop to `HomeShell` and `Shell`.

**Exports** (`index.ts`): Platform creation functions, `Platform` interface, data types (`FileEntry`, `Project`, `RecentFileRecord`, `Workspace`, `Collection`, `VersionEntry`, etc.), pure helpers (`uuid()`, `contentHash()`, `detectFileKind()`, `fuzzySearch()`, etc.).

### Engine cascade mirrors the pattern

Both `@varve/engine` and `@varve/print` use the same probe pattern:
- `engine.ts:389-405`: `createEngine('auto')` — tries native if `__TAURI__`, then WASM, then stub
- `print/src/index.ts:27-47`: `createPrintEngine('auto')` — tries native if `__TAURI__`, else stub

#### Risks and unknowns

- **Nine independent `isTauriRuntime()` implementations** — if the detection key ever changes (Tauri 3?), all must be updated or some code silently breaks.
- **`detectPlatform()` returns memory platform in browser** — callers that use `detectPlatform()` in the browser get a memory-backed platform with no persistence. The web platform must be explicitly constructed via `createWebPlatform()` (async). This is a documented design decision (detect.ts:9-12) but likely to trip up new implementers.
- **`fileExists()` always returns `true` in web** — any code that checks `fileExists()` before operations will never skip operations in the browser.
- **PDF export is desktop-only** — the `AssetExportControls.tsx` gate means browser users cannot export PDFs at all. If browser PDF generation is needed, it would use the `@varve/print` stub which produces placeholder results.
- **Version history uses localStorage in Tauri** (`tauri.ts:696-897`) — this is a documented "interim measure". The Rust SQLite backend doesn't yet serve version history.

---

## Cross-cutting concerns

### Duplicated concepts

| Concept | Occurs in | Issue |
|---------|-----------|-------|
| `AuditFinding` type | `scene/auditFinding.ts` + `shared/auditTypes.ts` | Different shapes, incompatible |
| `WorkspaceMode` type | 4 files | 2 are missing `'codegen'` |
| `isTauriRuntime()` | 9+ files | Brittle — detection key change breaks all |
| Rule registration | `scene/auditEngine.ts` + `editor/intelligence/registry.ts` | Separate systems, no interop |
| Scan scheduling | `scene/auditEngine.ts` + `scene/intelligence/auditScheduler.ts` | Parallel, one is unwired |
| ID generation | `scene/node-id.ts` + `scene/ids.ts` | Two systems, one unused for nodes |

### Bypassed subsystems

- **`registerBuiltinRules()` is defined but never called** — the entire audit engine rule registry is empty.
- **`AuditScheduler` is never wired to the engine** — the scheduler has debounce, rate limiting, and preflight but nothing uses it.
- **`AuditUtilityPanel` exists but isn't wired into the editor** — standalone component with no trigger.
- **`OverlayManager` has rendering infrastructure but nothing renders it** — audit findings exist only in panels, never as canvas overlays.
- **Some operations bypass the transaction API** — `createShapeAt`, `createTextNodeAt`, `applyFramePreset` push directly to `undoStackRef`.

### Keeping up to date

This brief was generated from the codebase on 2026-07-25. When the subsystems described here change, update the relevant section and bump the date at the top. The linked file:line references are the best invariant for future cross-checks.
