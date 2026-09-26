# DTCG document tokens — runtime integration evidence

- Date: 2026-09-25
- Branch: `master`
- Status: Integration and validation in progress; the commands below distinguish
  completed checks from pending browser and native execution.

## Ownership and standards

The stable target is the DTCG **2025.10** Format, Color, and Resolver family,
[published 2025-10-28](https://www.designtokens.org/technical-reports/) as Final
Community Group Reports. These reports are not W3C Recommendations.

Three token systems have separate owners:

| System | Owner | Purpose |
| --- | --- | --- |
| Application appearance | `@varve/ui` | Light, Dark, and High Contrast CSS tokens; document imports do not alter application chrome |
| Authored document tokens | `@varve/scene` | Stable identities, provenance, source/base snapshots, local changes, Variables and node bindings, document persistence |
| Standards interchange | `@varve/tokens` | Format and Resolver parsing, validation, references, merge and serialization; no React or scene dependency |

The renderer consumes the existing binding result. No token parser, source read,
or reference traversal runs in a per-node drawing loop. Immutable VariableStore
identity owns the document/projection caches; edits create a new store and undo
restores the earlier identity.

## Runtime support and explicit limits

| Authored type or feature | Document retention and export | Artwork projection |
| --- | --- | --- |
| Structured color, numeric components | Original space, precision, alpha and optional hex retained | Managed color, using source profiles for sRGB, Display P3, A98, ProPhoto and Rec.2020; floating-point RGB conversion for Lab/LCH and other calculated spaces |
| Color component `none`, invalid/nonfinite component, invalid alpha | Valid missing-component semantics retained; invalid inputs diagnosed | Unavailable with a reason; no fabricated channel or hex fallback |
| Number | JSON number | Numeric binding |
| Dimension in `px` | Value and unit retained | Numeric CSS-pixel value |
| Dimension in `rem` | Value and unit retained | Unavailable until document root-font context exists; never treated as px |
| Font family, single string | String retained | Scalar projection exists; dedicated font-family binding picker is pending |
| Font family list | List retained | Unavailable; selecting an installed fallback requires a policy |
| Numeric font weight | Number retained | Scalar projection exists; dedicated font-weight binding picker is pending |
| Named font weight, duration, cubic Bézier and composites | Typed values and references retained | Unavailable through scalar Variables; importing is not a claim of composite rendering |
| Complete curly aliases and JSON Pointer value/property references | References retained | Shared standards resolver, then the same typed projection as literals |
| Unknown vendor extensions | Preserved | No implicit vendor behavior |
| Selected Resolver context | Resolved Format snapshot imported | Context values become ordinary document tokens; other contexts and project composition are not exported |

Color projection does not clamp components or quantize through an 8-bit hex
string. The optional `hex` member is retained as interchange metadata; runtime
uses the structured channels. Conversions needed by the renderer can exceed the
sRGB gamut and remain floating point. These are runtime policy choices, not
additional DTCG parsing restrictions.

## User workflows

Open **View → Panels → Variables and Tokens…**. Import previews show source,
context, diagnostics and counts before a single undoable apply transaction.
Duplicate keys, unsafe or missing sibling references, unresolved aliases and
ambiguous names are reported before apply. Imported variable names use complete
paths, avoiding duplicate leaf labels.

**Create token** supplies an explicit scalar type, full path, typed value and
unit. Its alias picker offers existing tokens of the same type. Invalid input
keeps the form open with an actionable error. Complex authored values remain
available through source-content JSON; a dedicated composite editor is pending.

Edits through Variables update the canonical authored record as well as its
backing Variable. Numeric dimension edits preserve the referenced unit when an
alias becomes a literal. Changes are validated against the complete document
reference graph before being committed.

A re-import is a base/local/remote merge. Unresolved conflicts keep Apply
unavailable. The proposed whole document is checked again after conflict choices,
including aliases retained outside the incoming source and path collisions with
local tokens. Removing a supported token detaches its binding with the last
resolved literal, preserving artwork. A deletion that leaves another alias
unresolved is blocked. Group metadata is preserved by initial import and export;
source updates that change it are blocked with a specific limitation diagnostic.
A new source cannot replace different metadata already stored at the same group.
Groups containing no source-owned tokens have no ownership provenance, so their
removal cannot yet be attributed safely to one source.

Pending reads and previews are owned by the current document and source revision.
Cancel, a newer selection, source editing, or a document switch invalidates older
reads. Duplicate File names in one selection are rejected before reading bytes.
Picker admission is bounded to 256 files, 16 MB per file and 64 MB total.

## Complaint-informed acceptance criteria

The [research ledger](dtcg-interop-evidence-2026-09-25.md) separates firsthand
reports from verified artifacts. The following reports motivate practical checks;
they do not establish current product-wide failures.

| Reported symptom | Varve response | Evidence target |
| --- | --- | --- |
| [Tokens Studio #3778](https://github.com/tokens-studio/figma-plugin/issues/3778): flattened aliases | Canonical export retains authored references while artwork resolves them | Runtime E2E export plus standards unit tests |
| [Figma 48474](https://forum.figma.com/t/48474): descriptions absent from export | Token and group metadata survive canonical export | Existing metadata round-trip tests |
| [Penpot 9946](https://community.penpot.app/t/9946): private mode extensions not applied | Preserve extensions; explicit Resolver context and snapshot limitation | Resolver import diagnostics and context tests |
| [Penpot 10544](https://community.penpot.app/t/10544): transformations needed between multi-set exports | Content-based format routing, explicit source inputs and diagnostics | Import workflow tests; no claim that a vendor envelope is standard Format |
| [Figma modes documentation](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables): normalized duplicate names dropped | Full-path display and blocking path-collision validation | Source update collision and import tests |
| Pull or re-import overwrites local work | Preview, three-way conflicts, single transaction and undo | Existing sync E2E and update-plan tests |

## Execution evidence

Core standards agent checks completed before runtime integration:

- `pnpm --filter @varve/tokens test`: 179 tests passed.
- Focused shared Format resolver tests: 10 passed after index lookup optimization.
- Token package typecheck and scoped Biome checks passed.

The shared resolver initially rescanned all token pointers for every lookup.
Direct decoded pointer segments now use the existing token index. An informal
shared-machine probe (resolution only, not parsing) measured 1,000 aliases at
1,334.2 ms before and 10.5 ms after; 10,000 aliases took 80.9 ms after. These
measurements identify an algorithmic improvement, not a stable performance budget.

### Integration checks completed

- Shared standards focused suite: 5 files / 115 tests passed, including root
  `$extends`, resolved property-reference owner validation and a 10,000-token
  reference-chain graph without recursive stack overflow.
- Focused runtime, import and preview suite: 6 files / 98 tests passed.
- Rebuilt WASM/runtime regressions: 5 files / 62 tests passed; the two WASM
  checks load the actual baseline and SIMD artifacts rather than a mock.
- `cargo test -p varve-core managed_color_precision_uses_camel_case_wire_metadata`:
  passed; `just wasm-build`: baseline and SIMD builds passed. Optional
  `wasm-opt` optimization was unavailable and skipped by the build helper.
- Both website production and project-base builds passed. The feature's
  Playwright spec passed all four variants twice, most recently after adding
  an image-load assertion, horizontal-scroll hint and closer captures.

### Defects found by execution and visual inspection

The first actual canvas check painted a bound color as transparent. A standalone
probe of the compiled WASM IR showed Rust dropping TypeScript's camel-case
`bitDepth`. Rust now reads/emits that spelling while also reading legacy
`bit_depth`; the rebuilt IR preserves floating channels, alpha and profile.

The next browser run painted all three rectangles through curly, pointer and
local aliases, and propagated a source edit without reselection. Undo then failed
because exact history replay did not match the updated document. That failure is
under investigation; color propagation alone is not recorded as complete history
verification. The final export, theme and save/reopen steps have not yet passed.

Opened runtime captures exposed clipped resolved values and an unsupported-value
reason. Variables now show readable profile/channel labels, wrap long paths and
values, and preserve precision when an unchanged displayed value is committed.
Picker reasons wrap within their option. Fresh final captures will be inspected
again after the history repair.

The marketing captures have been opened in desktop/light and mobile/dark under
both base paths. The real binding image loads, the mobile page does not overflow,
and the wide capability table remains keyboard-focusable and horizontally
scrollable. Close-up hero and table captures support readable inspection.

### Validation still in progress

The owned-path triage plan passed formatting, lint, docs, emoji, inspector CSS,
token contrast/usage (315 pairs / three themes), spacing and sizing audits. It
stopped at compiler errors in a concurrent WebGPU E2E file. A previous Rust
closure passed core/clippy and the reverse engine crates, then revealed the
standalone desktop crate being invoked from the wrong workspace. The lane mapper
is repaired and its 50 policy tests plus CI plan checks pass; that infrastructure
change requires a final full checkpoint.

Linux desktop preflight passed. The current native build exposed two integration
TypeScript errors, repaired, plus concurrent retouch compiler errors. An older
native test binary is not evidence for these changes. Native execution, external
consumer checks, final affected/full checks and the final Agent Validation Report
remain pending. A lease wait for the architecture audit timed out; it has been
requeued without reclaiming any live lease. Windows and macOS are unavailable
locally. Browser execution uses the desktop frontend; `apps/web` remains a
placeholder and is not advertised as a separate validated application.

See the [workflow coverage matrix](runtime-coverage-2026-09-25.md) for supported,
partial and unverified surfaces. This document will be updated before completion.

## Deferred capabilities

Filesystem watch/write, Git-provider synchronization, authenticated vendor
integrations, arbitrary private extension interpretation, multi-context Resolver
project round-trip, rem root-font policy and composite property bindings remain
unconnected or unsupported. The current UI uses explicit manual import/export.

See [target architecture](dtcgsync-architecture.md) for the longer program;
architecture ports and target milestones are not shipped capability claims.
