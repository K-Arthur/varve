# Authored-token workflow coverage — 2026-09-25

This matrix separates standards handling from property support. The target is
DTCG 2025.10; a retained value is not a claim that a property picker or renderer
implements its semantics. Execution results and opened captures are recorded in
[runtime evidence](runtime-binding-2026-09-25.md).

## Coverage matrix

`Verified` means an automated check exercises that stage. `Partial` means the
stage works only for the stated subset. `Unsupported` and `Unverified` identify
different gaps: the former is deliberately unavailable; the latter has no
sufficient evidence yet.

| Area | Parse | Validate | Retain | Resolve | Edit | Bind | Render | Serialize | External interoperability |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Color | Verified: all 14 declared spaces | Verified: shape, components, alpha and missing channels | Verified: space, precision, alpha and optional hex | Verified: curly and pointer references | Partial: source JSON or scalar hex; unchanged precision survives | Partial: supported solid fills | Verified: managed-color pixels and float channel wire | Verified: canonical DTCG export preserves authored fields | Partial: published schema + Style Dictionary 5.5.5; its CSS transform omits the token-level pointer alias |
| Number | Verified | Verified: finite DTCG number | Verified | Verified: shared graph | Verified: typed scalar form and Variables | Partial: existing numeric properties | Verified: real opacity binding, Variables edit, canvas pixels and undo | Verified: canonical JSON number | Partial: exact fixture probe only |
| Dimension | Verified | Verified: value and unit; px and rem preserved | Verified: authored unit | Verified: aliases and pointers | Partial: typed edits preserve units; px-to-rem loss is blocked | Partial: px length properties | Verified: real px radius binding, Variables edit, authoritative redraw and undo; rem needs document root-font context | Verified: authored units retained | Partial: Style Dictionary 5.5.5 emitted the rem CSS value; root-font policy remains separate |
| Font family and weight | Verified: string/list and numeric/named forms | Verified: declared shapes | Verified: original forms | Verified: shared graph | Partial: single family / numeric weight; other forms use source JSON | Unsupported: dedicated binding pickers pending | Unsupported: no DTCG-specific text binding claim | Verified: authored forms and references retained | Unverified |
| Duration and composites | Verified: declared primitive/composite shapes | Verified: shape and nested reference owners | Verified: value, metadata and extensions | Partial: references resolve; contextual runtime projection absent | Partial: source JSON only | Unsupported: no scalar mapping | Unsupported: no fabricated rendering | Verified: canonical values retained | Unverified |
| Curly and JSON Pointer references | Verified: complete token and property forms | Verified: targets, cycles and owner types | Verified: authored reference form | Verified: shared indexed graph | Partial: alias creation/editing is distinct from literals | Partial: only when the resolved target type is compatible | Partial: follows the supported target projection | Verified: authored alias syntax is preserved | Partial: Style Dictionary omitted the token-level pointer alias |
| Resolver documents | Verified: resolver routing and sibling inputs | Verified: selected contexts and missing/unsafe dependencies | Partial: imported result is one selected Format snapshot | Verified: declared source order before alias resolution | Partial: source JSON; no Resolver project editor | Partial: follows mapped token types | Partial: supported mapped values only | Partial: resolved Format snapshot, not Resolver project round trip | Unverified beyond focused fixtures |
| Unknown extensions | Verified: JSON data preserved | Partial: structure only; private semantics are not interpreted | Verified: unknown data retained | Unsupported: no implicit vendor behavior | Partial: source JSON | Unsupported: no inferred binding | Unsupported: no inferred rendering | Verified: namespaced extension payloads round-trip | Partial: independent consumer receives the bytes; vendor meaning unverified |
| Native Variables and expressions | Not a DTCG type claim | Existing safe native expression validation | Verified in the native document model | Verified by the native resolver | Verified by existing Variables controls | Partial: existing Varve property support | Partial: existing renderer behavior | Verified by Varve document persistence; no invented DTCG mapping | Unsupported as stable DTCG semantics |

## Value types

| Type | Parse / validate | Retain / canonical export | Resolve | Edit | Bind / render | Independent consumer |
| --- | --- | --- | --- | --- | --- | --- |
| Color | Unit tested, all 14 declared spaces | Structured source channels, alpha, optional hex | Curly and pointer; numeric channels projected without quantization | Local hex form or source JSON; Variables preserve unchanged precision | Supported solid fill via ManagedColor; `none` unavailable with a reason | Exact browser artifact probe, separately recorded |
| Number | Unit tested | JSON number | Shared resolver | Typed scalar form and Variables | Opacity property, canvas pixel, Variables edit, undo verified in browser | Exact artifact probe only where present |
| Dimension | Unit tested, px/rem only | Value and unit preserved | Shared resolver | Explicit unit form; numeric edit keeps original unit; edits and source updates that would turn a working px projection into rem are blocked | Corner radius, canvas pixels, Variables edit, authoritative redraw and undo verified in browser; rem unavailable without root-font context | Exact artifact probe only where present |
| Font family | String/list validated | Original value preserved | Shared resolver | Single-string form or source JSON | Projection for single string; dedicated font-family binding picker pending; lists retained only | Unverified |
| Font weight | Numeric/named forms validated | Original value preserved | Shared resolver | Numeric form or source JSON | Numeric projection; dedicated weight picker pending; named forms retained only | Unverified |
| Duration / cubic Bézier | Unit/shape validated | Preserved | Shared resolver including nested references | Source JSON | Retained only | Unverified |
| Stroke style / border / transition / shadow / gradient / typography | Composite shape validated | Preserved with metadata and references | Shared resolver; resolved owner shapes revalidated | Source JSON; dedicated forms pending | Retained only; no fabricated scalar binding | Unverified |
| Native string / boolean / expressions | Existing Varve capabilities | Native document semantics; no invented stable DTCG type | Existing native resolver | Existing Variables editor | Existing compatible properties | No stable DTCG claim |

## Workflow reachability

| Workflow | Current contract | Evidence / remaining gap |
| --- | --- | --- |
| First import | Content routing, reviewed bytes, source/store initialized on Apply; overlapping token/group paths block preview | Component and import tests; browser fixture starts from fresh document |
| Resolver | Explicit sibling files and selected contexts; declared order before alias resolution | Core and editor unit fixtures; imported result is one Format snapshot, not a Resolver project round trip |
| Local authoring | Full path, explicit scalar type/unit, same-type alias target | Form/local creation tests and browser workflow; native edit/history workflow pending |
| Reverse Variables edit | Canonical token plus backing Variable updated atomically | Atomic invalid-reference and precision-preservation tests; browser edit/history workflow; native execution pending |
| Source update | Base/local/remote, explicit conflict choice, identity ownership checks, complete proposed graph validation | Sync tests plus browser color update/history workflow; group metadata update and linked runtime projection changes require explicit limitation diagnostics |
| Deletion | Supported values materialized against the same pre-removal snapshot | Simultaneous foundation/alias deletion regression; retained-only values have no fabricated projection |
| Binding | Stable Variable identity, full-path picker, explicit incompatibility reason | Runtime tests and actual canvas pixels; node/property support remains the existing binding surface |
| Dependency invalidation | Curly and pointer dependency closure plus mode and token-record changes | Unit tests and source update without selecting artwork again |
| Undo / redo | Existing document transaction/history system | Source-update undo/redo passed the browser pixel checks and 17 exact history tests; native execution pending |
| Save / reopen | Authored records and links persist in existing document model | JSON round trip and HMR-isolated browser reload/reopen passed; reopened binding and canvas pixels verified |
| Export | Deterministic canonical Format; authored references retained | Actual browser download retains group/token metadata and references; source formatting and Resolver composition are separate contracts |
| External interoperability | Version/profile-specific observation | No universal Figma, Penpot, Tokens Studio, Terrazzo, or Style Dictionary compatibility claim |
| Native access | Standalone Linux desktop Rust crate compiled and 130 tests passed | Full Tauri application launch and token UI workflow remain unverified; Windows/macOS unavailable locally |
| Source watch / Git / external write | Unconnected target architecture | Manual import/export only; no mutation of external repositories |

## Risk-based scenario evidence

| Requested scenario | Exercised scope | Remaining evidence boundary |
| --- | --- | --- |
| A — fresh project | Real file input, reviewed first import, typed local token/alias, three actual fill bindings, foundation update, undo/redo, metadata/reference download, three interface themes, HMR-isolated save/reopen | Fresh native UI run pending; the color workflow does not establish a complete typography/card system |
| B — brands and density | Resolver ordered composition and selected modifier contexts; native collection-mode precedence and cache invalidation tests | Multi-brand component instances, overrides and a rendered context matrix unverified |
| C — rich design | All declared color-space projections and compiled float-color wire; px corner-radius and number/opacity browser workflow including redraw and undo | Missing-font policy, typography, composite effects and motion bindings remain unsupported or unverified |
| D — metadata exchange | Browser download asserts group/token descriptions, deprecation, unknown extensions, curly aliases and pointer retention; exact download consumed by AJV and Style Dictionary 5.5.5; emitted CSS rendered and checked in Chromium | Consumer omits the token-level pointer; browser reimport identity continuity remains unverified |
| E — identity and refactoring | Existing merge identity plus path-collision, duplicate/foreign stable-ID and deletion/dependency tests; linked type or projection changes explicitly blocked | Cross-document/library remapping and a complete rename/move UI unverified |
| F — preview races | Component tests for overlapping reads, cancel, source editing, document switch, duplicate picked names, stale revision and no-op feedback; Apply confirms its exact committed VariableStore | Native multi-window source races unverified; no watcher capability claimed |
| G — Resolver project | Content-based routing, selected context, explicit sibling inputs, duplicate-key detection, missing dependencies, URI/traversal containment | Import is one resolved Format snapshot; Resolver project/composition round trip unsupported |
| H — concurrent edits | Base/local/remote merge tests, per-token conflict component tests, complete proposed graph validation, exact source-update history replay | External writes, permissions and interrupted multi-file transactions remain outside the connected manual workflow |
| I — adversarial recovery | Duplicate keys with locations, file admission limits before reads, unsafe references, unresolved aliases, wrong resolved owner types, own-key-safe import/export/projection and metadata history | Native disk/permission/watch-event failure paths are not certified by browser or parser tests |
| J — extended editing | Full-path typed controls, same-type alias picker, visible disabled reasons, three application themes; 1k/10k synthetic pipeline timings recorded | 10k parse/validation measured 7.75 s on the documented Linux/Node run; interactive large-library responsiveness, keyboard/virtualization, memory plateau, mixed selections and native UI execution pending |

## Remaining program boundaries

Dedicated composite editors and property bindings, font family/weight binding
controls, rem root-font policy, group metadata three-way merge, multi-context
Resolver project round trip, platform generators, external write/watch/Git
adapters, and cross-document/library identity remapping remain separate work.
Nested components, instance overrides, cross-page consumers and every export
backend are not covered by the focused color workflow and must not be advertised
as exhaustively verified from it.

No document schema migration is introduced by this integration. Rust now emits
camel-case `bitDepth` precision metadata and still accepts legacy `bit_depth`.
Rollback must rebuild both WASM artifacts and the native binary after reverting
implementation commits; restoring only frontend files would leave mixed wire
contracts.
