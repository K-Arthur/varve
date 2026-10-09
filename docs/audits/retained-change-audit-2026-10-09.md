# Retained change audit since v0.2.1 (2026-10-09)

## Scope and method

This audit uses the `v0.2.1` release tag (`d47cea2b9`) as its baseline and
freezes the retained-tree inventory at `689145bf6`, before this report was
added. At that cut, `v0.2.1..HEAD` contains **3,607 commits**, **6,434 changed
paths**, and a textual diff summary of **912,014 insertions / 82,996
deletions**. The counts describe the net tree delta: reverted-only work is not
treated as shipped, while tests, screenshots, vendor code, generated evidence,
and documentation are included and classified separately.

The audit inventoried every changed path and commit in that range, grouped the
surviving work by package and product area, and checked current feature claims
against implementation, tests, qualification notes, release records, and
website copy. Commit subjects help locate the history; they are not treated as
proof that a feature shipped. This is a retained-state and documentation-truth
audit, **not a line-by-line manual review of all 912,014 textual additions** or
a certification of every code path and model output. Vendored source is
accounted for as third-party material, not as Varve-owned product behavior.

## Exact release-tag interval: v0.2.1 to v0.5.0

The user asked for the work retained specifically between the v0.2.1 and
v0.5.0 releases, so this interval is recorded separately from the broader
`v0.2.1..HEAD` inventory below. The tag interval contains **3,594 commits**
and a net diff of **6,424 paths, 910,532 insertions, and 82,842 deletions**.
The v0.5.0 tag points to frozen product source `0c9b07fa9`; `v0.5.0..HEAD`
contains 14 later commits and 73 changed paths, but no changes under
`packages/`, `crates/`, or `apps/desktop/`. Those later commits are release,
website, documentation, and validation work; they do not redefine the v0.5.0
editor/engine behavior reviewed here.

This was a retained-tree audit with targeted commit-history review, not a
manual semantic review of every commit or every line in the 910,532 added
lines. The full path and commit inventories locate the work; for each public
workflow below, the review followed relevant introduction and corrective
commits into the final tagged implementation, tests, qualification evidence,
and current user guidance. Reverted-only work and third-party vendor changes
were not counted as shipped Varve features.

### v0.5.0 feature-to-documentation crosswalk

| v0.5.0 release-note area | Current user guidance and remaining scope |
| --- | --- |
| Six workspaces and flexible panels | `/docs/workspaces` covers the six modes, shared document model, layouts, and panel behavior. |
| Illustration, brush, and tablet controls | `/docs/touch-and-pen` and `/docs/tools/strokes` cover input routes, brush controls, and device-specific pressure/tilt support. |
| Comic lettering | New `/docs/tools/comic-lettering` guide covers creation, fitting, tails, and incomplete workflows; `/features/comic-lettering` retains the broader capability summary. |
| Photo workflows | `/docs/tools/retouching`, `/docs/tools/raw-hdr-photo`, `/docs/tools/image-treatments`, `/docs/tools/image-enhancement`, `/docs/tools/colorization`, `/docs/tools/depth-blur`, and `/docs/tools/generative-editing` state tool-specific inputs and qualification limits. |
| Vector and type tools | `/docs/tools/shape-building`, `/docs/tools/typography`, and `/docs/tools/image-trace` cover the corresponding workflows and format boundaries. |
| Reusable patterns | `/docs/tools/patterns` describes source editing, repeat placement, seam inspection, and SVG/PDF subset limits. |
| Presentation decks | `/docs/presentations` marks the workflow experimental and documents raster PDF/PNG delivery and formatting/accessibility limits. |
| Manual Token Sync | New `/docs/tools/design-tokens` guide explains import, bind, three-way review, export, and the lack of watchers, Git, write-back, and vendor adapters; the feature page carries its full standards matrix. |
| Local Wasm plugins | `/docs/plugins` and `/features/plugins` describe the experimental local package model, permissions, and intentionally absent marketplace/general extension APIs. |
| Mockups and exports | New `/docs/tools/mockups` guide documents supported surfaces and export behavior; `/features/mockups` explicitly bounds the feature to 2D mappings rather than full 3D. |
| PDF artwork, dimensions, and print options | `/docs/file-formats` and `/docs/tools/export` describe embedded artwork, dimensions, supported PDF/PDF-X paths, and text outlining. |
| Experimental renderer options | `/docs/settings` and `/docs/rendering` distinguish Canvas2D default from opt-in WebGL2/WebGPU paths and their fallbacks. |
| Schema 2.33 compatibility | `/docs/file-formats` gives the v0.2.1 schema 2.21 baseline, migration behavior, backup advice, and forward-compatibility boundary. |
| Save, history, and recovery | `/docs/settings` has been corrected: autosave creates internal local copies/recovery points on the configured 1–60 minute interval; it does not write the user's chosen file or mark it saved. `/docs/file-formats` and `docs/architecture/save-destinations.md` describe explicit destinations and save states. |
| Responsive and accessible controls | `/docs/workspaces`, `/docs/touch-and-pen`, and `/accessibility` describe responsive layouts and supported input/accessibility boundaries. |
| Fit the active surface | `/docs/workspaces` now explains Fit Canvas versus Fit Page, including empty canvases and blank publishing pages. |
| Document-name entry and selection/import feedback | These are interaction and error-feedback refinements rather than standalone features; `/docs/getting-started/first-project` and `/docs/file-formats` cover the user-facing name/import workflows, while release notes preserve the implementation detail. |
| Bounded browser demo | `/docs/browser-demo` documents its sample-document, storage, offline, workspace, and inference limits. |
| Consent-first desktop updates | `/docs/updates` describes consent, package coverage, signature verification, and manual-only package/platform cases. |

### History checks that changed or validated user-facing truth

Commit subjects were used to find candidate work, then the final tree and
adjacent fixes were checked before updating copy. Examples include:

| Workflow | Introduction and corrective history in the tag interval | Final-state fact used in public guidance |
| --- | --- | --- |
| Comic lettering | `a1eb9165c`, `a8acf5fb2`, `07b690f6f`, then outline/editing fixes `57c2128e5` and `c62822503` | The balloon is a recipe over normal editable nodes; its text remains text. Fitting reports overflow instead of shrinking type, and the dedicated drag tool/joined balloons/vertical contour columns remain out of scope. |
| Design Token Sync | `a40a424c6`, `78c28571b`, `7d03966b1`, `79fe9d8ca` | External updates use a reviewed base/local/source merge; file watching, Git-backed sources, source write-back, and vendor dialect claims remain absent. |
| Mockups | `b96e564b0`, `a8839901d`, `0ad367b8b`, export follow-up `4b7fdd7e5`, and source-ownership repair `0746ea753` | Planar, projective, bounded cylindrical, and mesh-envelope surfaces compose through supported exports; PDF/X and code export boundaries are explicit, and no full 3D or PSD smart-object round trip is claimed. |
| Save and recovery | `ae5aa86b6`, `14de668b0`, `88b581e1d`, `a3656a1d7`, and `d89665b62` | Internal autosave/recovery is separate from the user's authoritative save destination; the Settings guide was stale about page-hide saves and the interval range and is now aligned to the UI and persistence implementation. |
| Fit active surface | `a054ca08f` | The status-bar fit target follows the active surface and disables only when an unbounded Design Canvas has no artwork; a blank publishing page remains fit-able. |

The page-level review also kept gated or qualification-pending image behavior
separate from shipped behavior: promptless local reconstruction is not
prompt-conditioned generation; browser AI-quality Expand is awaiting
independent real-photo qualification; and browser Fast/PatchMatch Expand
remains disabled after edge striping. Details and complaint-informed failure
modes are recorded in the image-editing sections below.

### Documentation and website updates from the release-range review

This follow-up adds task guides for Comic Lettering, Design Tokens, and
Mockups; links the complete v0.5.0 workflow guides from the Documentation
index; adds Fit Active Surface guidance to Workspaces; corrects the inaccurate
autosave description in Settings; and expands Known Issues to distinguish
current feature boundaries from defects that may be addressed later. The
three marketing feature pages cross-link their practical guides. No code was
changed to make the copy true.

## Retained-tree inventory

| Area | Changed paths | What the inventory contains |
| --- | ---: | --- |
| `packages/` | 2,930 | Editor (1,608), engine (557), scene (273), UI (188), home/workspace, shared, import, platform, compositor, codegen, history, tokens, and support packages |
| `docs/` | 1,797 | Screenshots (1,096), audits (312), architecture (125), agent guidance, research, plans, release, ADRs, quality, and performance records |
| `tests/` | 727 | E2E (687), fixtures, unit and integration coverage, and retained evidence |
| `apps/` | 443 | Website (391) and desktop application (52) |
| `scripts/` | 276 | Release, quality, performance, screenshot, and repository tooling |
| `vendor/` | 127 | Third-party code and notices; not Varve feature claims |
| Other repository and native areas | 134 | Rust crates, workflows, examples, packaging, toolchain/configuration, licenses, and root guidance |

The path totals above sum to 6,434. The v0.5.0 website had 116 built routes at
the reviewed release; this follow-up adds three documentation routes, bringing
the current site build to 119. Feature and documentation pages were treated as
public product claims rather than inferred from the size of the route tree.

## Product areas represented by the surviving work

The net tree spans the shared document/scene model and editor; canvas rendering,
selection, inspector, layers, and history; vector, layout, typography, and
illustration workflows; image import and editing; motion, timeline, and
prototyping; plugins and workspace/home flows; export and print; desktop/native
and browser/WASM paths; platform packaging and updates; privacy, security, and
release automation; and the public website, tests, and documentation.

The canonical architecture and feature documents remain the detailed behavior
records. This audit found the current image-oriented website surfaces and
their linked guides materially aligned with their documented qualification
boundaries for background removal, enhancement, image trace, image treatments,
RAW/HDR photo, retouching, colorization, and Object Selection. Their existing
limits should remain visible; this review does not turn route presence or test
coverage into a universal image-quality claim.

## Image editing and generative fill findings

The current implementation and its qualification record distinguish local
promptless reconstruction from semantic generation:

| Workflow | Retained status | Public-copy consequence |
| --- | --- | --- |
| Mask-guided Fill and Remove | Local reconstruction paths are implemented; prompts do not make the LaMa path semantic. | Describe as promptless reconstruction. Do not imply that LaMa follows a natural-language instruction. |
| Desktop promptless Expand | Available within the measured photo boundary on Linux x86_64. | State the platform and qualification boundary. Do not generalize this evidence to every image or platform. |
| Browser AI-quality Expand | Exposed after the user installs the local LaMa model; independent real-photo browser qualification is still pending. | Call it implemented-pending-qualification, not verified browser parity. |
| Browser Fast/PatchMatch Expand | Deliberately disabled after visible edge striping in real-photo review. | Keep the block and its reason explicit; do not describe the fallback as a quality-equivalent option. |
| Prompt-conditioned Fill, Replace, and Expand | Gated; the retained diagnostic model/runtime combination did not pass compatibility and semantic-quality requirements. | Do not claim shipped prompt-conditioned generative fill or silently route a prompt to a promptless model. |

The pixel-protection contract is stronger than the model's raw output: zero
coverage in the final composite preserves source pixels byte-for-byte, while
mask growth and feathering define the editable edge. The dialog keeps the
editable user mask, provider mask, and composite mask distinct, supports
candidate review and source restoration, and applies accepted work as one
undoable edit. These properties reduce spill and recovery failures; they do
not guarantee that the generated content is semantically good or that every
mask boundary will look natural. The user should inspect the edge at 100%.

The complaint research is deliberately treated as anecdotal evidence, not a
prevalence estimate. It records Photoshop reports of edits extending beyond
selections, loss of a useful prompt-free workflow, and inpainting seam reports
from Diffusers users. Varve's realistic responses are strict final compositing,
visible and editable masks, explicit promptless-versus-prompted modes,
reviewable candidates, Restore Original, local opt-in model installation, and
honest qualification gates. See the
[generative editing model landscape](generative-editing-model-landscape-2026-09-12.md),
[selection-model audit](generative-editing-selection-model-audit-2026-09-14.md),
[architecture contract](../architecture/generative-editing-system.md), and
[complaint-informed failure-mode review](../research/design-tool-failure-modes-2026-10-02.md).

This follow-up corrected the contradictory public summaries in the
[Generative Editing feature page](../../apps/website/src/pages/features/generative-editing.astro),
[tool guide](../../apps/website/src/pages/docs/tools/generative-editing.astro),
and [marketing positioning brief](../marketing/positioning-and-discovery.md).
The [background removal](../../apps/website/src/pages/features/background-removal.astro),
[image enhancement](../../apps/website/src/pages/features/image-enhancement.astro),
[image trace](../../apps/website/src/pages/features/image-trace.astro),
[image treatments](../../apps/website/src/pages/features/image-treatments.astro),
[RAW/HDR photo](../../apps/website/src/pages/features/raw-hdr-photo.astro),
[retouching](../../apps/website/src/pages/features/retouching.astro),
[colorization](../../apps/website/src/pages/features/colorization.astro), and
[Object Selection](../../apps/website/src/pages/features/object-selection.astro)
pages were also checked against their current feature guidance; no additional
copy correction was identified in this pass.

## Screenshot spacing follow-up

The supplied `/docs/updates` screenshot showed the platform-status paragraph
outside the shared documentation section rhythm, leaving too little separation
before “What happens on first launch?”. The paragraph now uses the existing
`.docs-section` layout, restoring the established inter-section spacing without
adding a one-off value. Browser measurements show a 56 px desktop gap at
1440×960 and a 45.5 px gap at 390×844, with no mobile horizontal overflow.
Dedicated desktop/mobile assertions and screenshot baselines live in
`apps/website/tests/e2e/updates.visual.spec.ts`.

## Release-range guides and limitations-page visual review

Desktop and phone-width full-page captures of the new Comic Lettering, Design
Tokens, and Mockups guides and the expanded Known Issues & Limitations page
were inspected at 1440×1000 and 390×844. The capture caught missing spaces
around inline links and commands in the new guides; those were corrected and
recaptured. The final pages keep the established typography and section rhythm,
their task steps remain readable on narrow screens, and none has horizontal
overflow. The limitations page is intentionally information-dense; its new
feature boundaries link to the workflows they qualify.

The release-range website slice was validated after refreshing the two
intentional docs-index and Workspaces screenshot baselines. `pnpm verify:plan`
selected the website checks and reported **no full-suite escalation**.
`pnpm verify:affected` passed the docs, emoji, radius, E2E typecheck, website
typecheck, JavaScript unit, website unit, and browser lanes; the two unit lanes
each passed **285 tests**, and all **678 website E2E cases** passed across GH
Pages, custom-domain, and touch projects. The build emitted **119 routes**.
The commit checkpoint also passed its staged health, impact, secret, contact,
emoji, and docs audits. Rust/native, model-quality, packaging, and full-repo
gates were not selected for this documentation-only slice.

## Validation and commits

For the staged implementation and site changes, `pnpm verify:plan --staged`
selected affected website checks and reported **no full-suite escalation**.
`pnpm verify:affected --staged` passed the selected format/lint, emoji, radius,
docs, website E2E typecheck, website typecheck, website unit, and website E2E
lanes. The website E2E lane passed all **678 cases** across the GH Pages,
custom-domain, and touch projects. The focused visual run passed five cases and
updated the generative-editing and Updates-page baselines. The live page was
also inspected at desktop and mobile sizes. Commit hooks passed for both
follow-up commits; they do not certify the deferred native GUI, model-quality,
release, Rust workspace, or full-repository suites.

The follow-up was committed in reviewable slices:

- `a00f29279` — clarify image-generation capability boundaries.
- `689145bf6` — restore Updates-page section spacing.
- `972562cc4` — record the retained post-v0.2.1 audit scope.
- `b34081aa5` — add v0.5.0 feature guides and expand the limitations page.

These audit changes were not pushed as part of this work.

## Reproduction commands and interpretation

Run these from the repository root to refresh the inventory at a chosen
revision:

```bash
git rev-list --count v0.2.1..HEAD
git diff --name-only v0.2.1..HEAD
git diff --shortstat v0.2.1..HEAD
```

Changed-path counts answer “what remains different in the tree?”; commit
subjects answer “where should the history be searched?” Neither count alone
answers “what is verified for users?” For that, use the linked architecture,
qualification, tests, release records, and page-level contracts, and preserve
the explicit pending and blocked states above.
