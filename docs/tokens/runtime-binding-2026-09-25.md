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
| Structured color, numeric components | Original space, precision, alpha and optional hex retained | Managed color, using source profiles for sRGB, Display P3, A98, ProPhoto and Rec.2020; Lab/LCH and calculated conversions for other defined spaces |
| Color component `none`, invalid/nonfinite component, invalid alpha | Valid missing-component semantics retained; invalid inputs diagnosed | Unavailable with a reason; no fabricated channel or hex fallback |
| Number | JSON number | Numeric binding |
| Dimension in `px` | Value and unit retained | Numeric CSS-pixel value |
| Dimension in `rem` | Value and unit retained | Unavailable until document root-font context exists; never treated as px |
| Font family, single string | String retained | String binding; renderer font availability still applies |
| Font family list | List retained | Unavailable; selecting an installed fallback requires a policy |
| Numeric font weight | Number retained | Numeric binding |
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
unresolved is blocked.

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

The affected gate has already passed token contrast/usage, spacing/sizing and
emoji audits. Its first runtime attempt exposed a nullable XYZ conversion, now
repaired. A later attempt stopped at compiler errors in concurrent WebGPU edits;
those files belong to a separate task and were preserved. The focused runtime
rerun, browser screenshots, external-consumer probe, native execution and final
Agent Validation Report are pending and will be recorded here before completion.

Linux desktop preflight passed. An older native test binary is present but is
not evidence for these changes. Browser execution of the desktop web frontend
is also not native IPC evidence. Windows and macOS are unavailable locally.

## Deferred capabilities

Filesystem watch/write, Git-provider synchronization, authenticated vendor
integrations, arbitrary private extension interpretation, multi-context Resolver
project round-trip, rem root-font policy and composite property bindings remain
unconnected or unsupported. The current UI uses explicit manual import/export.

See [target architecture](dtcgsync-architecture.md) for the longer program;
architecture ports and target milestones are not shipped capability claims.
