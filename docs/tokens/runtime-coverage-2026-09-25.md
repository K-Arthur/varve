# Authored-token workflow coverage — 2026-09-25

This matrix separates standards handling from property support. The target is
DTCG 2025.10; a retained value is not a claim that a property picker or renderer
implements its semantics. Execution results and opened captures are recorded in
[runtime evidence](runtime-binding-2026-09-25.md).

## Value types

| Type | Parse / validate | Retain / canonical export | Resolve | Edit | Bind / render | Independent consumer |
| --- | --- | --- | --- | --- | --- | --- |
| Color | Unit tested, all 14 declared spaces | Structured source channels, alpha, optional hex | Curly and pointer; numeric channels projected without quantization | Local hex form or source JSON; Variables preserve unchanged precision | Supported solid fill via ManagedColor; `none` unavailable with a reason | Exact browser artifact probe, separately recorded |
| Number | Unit tested | JSON number | Shared resolver | Typed scalar form and Variables | Existing numeric properties | Exact artifact probe only where present |
| Dimension | Unit tested, px/rem only | Value and unit preserved | Shared resolver | Explicit unit form; numeric edit keeps original unit | px length fields; rem unavailable without root-font context | Exact artifact probe only where present |
| Font family | String/list validated | Original value preserved | Shared resolver | Single-string form or source JSON | Projection for single string; dedicated font-family binding picker pending; lists retained only | Unverified |
| Font weight | Numeric/named forms validated | Original value preserved | Shared resolver | Numeric form or source JSON | Numeric projection; dedicated weight picker pending; named forms retained only | Unverified |
| Duration / cubic Bézier | Unit/shape validated | Preserved | Shared resolver including nested references | Source JSON | Retained only | Unverified |
| Stroke style / border / transition / shadow / gradient / typography | Composite shape validated | Preserved with metadata and references | Shared resolver; resolved owner shapes revalidated | Source JSON; dedicated forms pending | Retained only; no fabricated scalar binding | Unverified |
| Native string / boolean / expressions | Existing Varve capabilities | Native document semantics; no invented stable DTCG type | Existing native resolver | Existing Variables editor | Existing compatible properties | No stable DTCG claim |

## Workflow reachability

| Workflow | Current contract | Evidence / remaining gap |
| --- | --- | --- |
| First import | Content routing, reviewed bytes, source/store initialized on Apply | Component and import tests; browser fixture starts from fresh document |
| Resolver | Explicit sibling files and selected contexts; declared order before alias resolution | Core and editor unit fixtures; imported result is one Format snapshot, not a Resolver project round trip |
| Local authoring | Full path, explicit scalar type/unit, same-type alias target | Form/local creation unit tests; browser and native workflows |
| Reverse Variables edit | Canonical token plus backing Variable updated atomically | Atomic invalid-reference and precision-preservation tests; native edit/history workflow |
| Source update | Base/local/remote, explicit conflict choice, complete proposed graph validation | Sync tests plus browser color update/history workflow; group metadata update requires an explicit limitation diagnostic |
| Deletion | Supported values materialized against the same pre-removal snapshot | Simultaneous foundation/alias deletion regression; retained-only values have no fabricated projection |
| Binding | Stable Variable identity, full-path picker, explicit incompatibility reason | Runtime tests and actual canvas pixels; node/property support remains the existing binding surface |
| Dependency invalidation | Curly and pointer dependency closure plus mode and token-record changes | Unit tests and source update without selecting artwork again |
| Undo / redo | Existing document transaction/history system | Browser/native execution must pass before claiming verified |
| Save / reopen | Authored records and links persist in existing document model | JSON round trip plus browser Save → reload → Home reopen |
| Export | Deterministic canonical Format; authored references retained | Actual browser download artifact; source formatting and Resolver composition are separate contracts |
| External interoperability | Version/profile-specific observation | No universal Figma, Penpot, Tokens Studio, Terrazzo, or Style Dictionary compatibility claim |
| Native access | Current Linux debug binary and direct IPC test | Browser runs are not native evidence; Windows/macOS unavailable locally |
| Source watch / Git / external write | Unconnected target architecture | Manual import/export only; no mutation of external repositories |

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
