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

The path totals above sum to 6,434. The website has 116 built routes at the
reviewed release, and its feature and documentation pages were treated as
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

Neither commit was pushed as part of this audit.

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
