# DTCG document tokens — runtime integration evidence

- Date: 2026-09-25
- Branch: `master`
- Status: DTCG integration and web/browser validation complete for the supported
  profile; native and platform coverage remains explicitly scoped below.

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
local tokens or stored groups. Exact token/group path collisions and duplicate
stable IDs block the plan. A source cannot claim an ID already owned by another
source or local token; the apply boundary repeats the identity check. Removing a supported token detaches its binding with the last
resolved literal, preserving artwork. A deletion that leaves another alias
unresolved is blocked. Group metadata is preserved by initial import and export;
source updates that change it are blocked with a specific limitation diagnostic.
A new source cannot replace different metadata already stored at the same group.
Groups containing no source-owned tokens have no ownership provenance, so their
removal cannot yet be attributed safely to one source.
A source update that changes the type of a token with a linked Variable is
blocked until an explicit migration can preserve property bindings and native
mode values. A distinct path is available for a new type. Supported token
deletion materializes stored native modes separately rather than copying the
active mode into the default slot.

Pending reads and previews are owned by the current document and source revision.
Cancel, a newer selection, source editing, or a document switch invalidates older
reads. Duplicate File names in one selection are rejected before reading bytes.
Picker admission is bounded to 256 files, 16 MB per file and 64 MB total.
The panel reports apply success only after the reviewed VariableStore is present
in the committed document. If a newer document wins the update race, it retains
the preview with a blocking stale-document diagnostic.

Prototype-like JSON keys are handled as own data throughout parsing, source
merging, scene projection, history capture and canonical export. This preserves
valid names such as `__proto__` without writing them through JavaScript object
prototype setters.

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
| Forged stable IDs can overwrite another source | Reject invalid, duplicate and foreign-owned IDs during planning and again at apply | Update-plan and direct-apply regressions |
| A changed document can make Apply look successful when no store was written | Confirm the exact resulting store before announcing success; retain a blocking stale preview otherwise | Token Sync component race regression |

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

- Complete token package in the affected lane: 10 files / 188 tests and its
  typecheck passed after the final standards changes.
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

The scalar browser check then found a second Rust-to-web IR wire mismatch:
rectangle radii were emitted as `corner_radius`, while the stable TypeScript
renderer contract reads `cornerRadius`. The bound value and engine node were
correct (`32`), but the renderer received the snake-case key and painted square
corners. Rust now serializes the field as `cornerRadius`; the engine crate has a
wire regression test, and both baseline and SIMD WASM artifacts were rebuilt.
The browser test passes with a real Variables edit, rounded-corner pixel,
opacity pixel, undo, and same-camera authoritative redraw. The corner sample is
identical before and after redraw. Whole-canvas comparison found only a bounded
antialiasing difference between worker and compositor output: at most 1/255 in
66 pixels (under 0.01% of the surface); this is recorded as a tolerance, not
claimed as byte-identical rendering.

The next browser run painted all three rectangles through curly, pointer and
local aliases, and propagated a source edit without reselection. Undo then failed
because exact history replay did not match the updated document. The focused
regression identified a shared-object cloning defect: replay changed a provenance
snapshot alongside the live token value. Capture cloning
now separates sibling occurrences, preserves own JSON keys without prototype
setters, and records arbitrary metadata keys through safe parent replacements.
The focused history repair passed 17 tests. The next browser run passed source
updates, undo/redo, metadata/reference export and three application themes. It
failed while reopening the saved document, with the application back on its
loading screen. The `VARVE_DISABLE_HMR=1` rerun passed the complete import,
history, export, reload/reopen and bound-pixel flow. Native UI execution remains
unverified.

An independent code review found additional boundary cases before the final
gate: a source could present another source's stable token ID, duplicate IDs
could collapse merge targets, and prototype-like paths could interact with
ordinary object properties. Planning and apply now reject identity collisions;
import, scene projection and export use own-key-safe containers. A linked value
that already projects to artwork also cannot be edited or remotely changed to
an unsupported value such as `rem` until its consumers are detached or the
required document context is implemented. Direct import, update and projection
regressions cover these boundaries; their exact results are in the final
validation report below.

Opened runtime captures exposed clipped resolved values and an unsupported-value
reason. Variables now show readable profile/channel labels, wrap long paths and
values, and preserve precision when an unchanged displayed value is committed.
Picker reasons wrap within their option. Fresh import, rem-reason, undo/redo,
Dark and High Contrast captures were opened and inspected; the artwork stayed
red in all application themes while the chrome changed.

The marketing captures have been opened in desktop/light and mobile/dark under
both base paths. The real binding image loads, the mobile page does not overflow,
and the wide capability table remains keyboard-focusable and horizontally
scrollable. Close-up hero and table captures support readable inspection.

### Final validation report

The private-index impact plan covered 105 DTCG-owned paths: the website, editor,
history, scene and tokens packages plus `varve-engine`. Tiers 0–4 were selected;
the planner reported **no full-suite escalation**. It passed formatting, lint,
docs, emoji, inspector CSS, token contrast/usage (315 pairs across three
themes), spacing and sizing audits, `typecheck:e2e`, the focused token/history/
scene tests, both DTCG browser specs, the website unit suite (239 tests), and
Astro/type checks. The editor package suite passed 8,082 tests with two skipped.

The remaining downstream JavaScript run reported 5,572 passing tests and one
failure in the existing scene mode-switch regression. That exposed a stale
collection-mode cache introduced by the token projection helper. The cache was
removed to preserve the established in-place mode-switch behavior; the focused
modifier and projection suites then passed 67 tests, and `@varve/scene`
typechecked. The new import workflow's optional metadata assertion and the
history fixture's store shape were also corrected; the exact import test passed
34 tests, the source-update history test passed two, and the affected editor,
scene and history typechecks passed. The broad downstream package suite was not
restarted after those small repairs.

Rust validation passed: `varve-engine` (9 tests, including the camelCase
`cornerRadius` regression), Clippy, `varve-wasm`, and the standalone Linux
desktop crate (130 tests). `just wasm-check` passed; `just wasm-build` built both
baseline and SIMD browser artifacts. The full Tauri application was not launched
for this run. A prior app build attempt hit `ENOSPC`, then a generic pnpm
lifecycle failure; the successful standalone crate tests do not substitute for
a native UI smoke. Windows and macOS are unavailable locally.

The DTCG browser flow passed with HMR disabled through source import, local
authoring, bound color/scalar edits, history, reload/reopen, and pixel checks.
The px-radius/opacity flow passed its same-camera redraw check and undo. The
Style Dictionary consumer probe was rendered in Chromium: three emitted colors
matched their pixels, `1.25rem` computed to `20px` with a 16px root, and the
token-level JSON Pointer alias was visibly omitted. The desktop/light and
mobile/dark marketing captures were refreshed and inspected. The added Design
Tokens feature card intentionally changes the dark feature-index page, so its
visual baseline was regenerated and its exact screenshot test passed. The
renderer replay visual corpus passed all 42 cases at 1×, 2× and 3×. The render
benchmark passed all six cases.

Two broader integration boundaries remain red or incomplete:

- The full website E2E run completed 578 tests and reported six failures before
  the feature-index baseline update: duplicate text matching in the separate
  Object Selection page (both base paths), one existing performance-page
  snapshot, the now-updated feature-index snapshot, and product-page snapshots
  in both themes. The DTCG page passed in desktop/light and mobile/dark under
  both base paths. The five other failing cases were not changed here.
- The selected `e2e:canvas` directory expands to 795 cases. Its leased run was
  stopped after nine cases, when the large-image adaptive-residency oracle
  exposed a different image hash for the worker's 2048px source-cap bitmap and
  the authoritative full-resolution compositor replay. Repeating the exact
  case with longer settling time produced the same result. This renderer
  resolution-parity issue is outside DTCG token projection; the focused DTCG
  scalar and color pixel checks pass. The broad canvas suite is therefore not
  reported as passing.

Earlier architecture-audit attempts reached `ts-prune` and hit its internal
60-second timeout; no architecture baseline was changed. The checkout contains
concurrent non-DTCG edits, so checkout-wide cycle/instability warnings from that
attempt were not attributed to this work. The independent `apps/web` surface is
still a placeholder; browser validation uses the desktop frontend.

See the [workflow coverage matrix](runtime-coverage-2026-09-25.md) for supported,
partial and unverified surfaces.

The reproducible synthetic benchmark now records 1k- and 10k-token single-context
cases in `docs/tokens/fixtures/dtcg-runtime-benchmark-2026-09-25.json`. On the
2026-09-27 Linux/Node 22 run, 10k parse plus resolved-value validation had a
7,751 ms median; graph construction, resolution, and canonical serialization
had 39 ms, 74 ms, and 35 ms medians. This measures the current deterministic
pipeline on one shared machine, not an in-browser responsiveness guarantee.
Large-library import responsiveness and memory plateau still need dedicated
interactive measurement before promising 10k-token editing as seamless.

## Deferred capabilities

Filesystem watch/write, Git-provider synchronization, authenticated vendor
integrations, arbitrary private extension interpretation, multi-context Resolver
project round-trip, rem root-font policy and composite property bindings remain
unconnected or unsupported. The current UI uses explicit manual import/export.

See [target architecture](dtcgsync-architecture.md) for the longer program;
architecture ports and target milestones are not shipped capability claims.

## Independent export consumer

The browser end-to-end check compares the exported JSON value with the retained
[DTCG fixture](fixtures/runtime-export-2026-09-25.tokens.json); formatting may
differ, and no compatibility preprocessing is applied. The published DTCG
2025.10 structural schema passed under AJV 8.20.0. This is an independent
structural check, not a substitute for normative semantic validation.

Style Dictionary 5.5.5, with `usesDtcg`, the CSS transform group and
`css/variables` with `outputReferences`, emitted the foundation, curly alias,
local alias and rem dimension. It omitted the token-level JSON Pointer alias.
The [consumer report](fixtures/runtime-export-style-dictionary-5.5.5.json)
records exact input/schema hashes and observed tokens. The unmodified
[generated CSS](fixtures/runtime-export-style-dictionary-5.5.5.css) is retained
separately from authored source. `node scripts/tokens/verify-consumer-css.mjs`
opens the generated CSS sample in Chromium, checks three emitted aliases against
actual RGBA pixels, confirms the omitted JSON Pointer alias leaves its outlined
swatch transparent, and checks that `1.25rem` computes to `20px` with a `16px`
root font. It writes
`docs/screenshots/dtcg-runtime-2026-09-25/independent-css-consumer.png` and a
structured result JSON. The run passed and the screenshot was visually
inspected; the observed omission is recorded as a version-specific
Style Dictionary behavior, not a universal adapter compatibility claim.

## Progressive commits

- `a1f40b6bf`: authored-runtime architecture and evidence boundaries.
- `661cfebe3`: workflow coverage and validation findings.
- `7d03966b1`: stable DTCG reference resolution and complete-graph validation;
  its normal commit checkpoint passed 115 direct standards tests. The complete
  token package had already passed 188 tests and typechecking.

- `d186910f3`: floating color precision through the engine wire.
- `527f62faa` and `3f6e375cd`: non-destructive first-use import and complete
  Token Sync import/export.
- `4e2e1fd37` and `7a366bc6a`: browser binding evidence and variable-only
  repaint repair.
- `78c28571b` and `426f43650`: three-way source updates and safe source editing.
- `c87b19f31`: binding-pass commit ledger.

The commits above are already on `master`; later commits in the same progressive
series cover local authoring, scalar editing, history, the website, and the
validation evidence recorded here. The current scoped validation batch is
committed separately on `master`.
