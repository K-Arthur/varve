# Workspace customization research and baseline — 2026-09-27

## Decision

Keep six core editor workspaces: Design, Print, Draw (`drawing`), Photo
(`image`), Motion, and Email. Fold Logo into Design's tools and retain Code as
a general panel. Email remains a workspace because its responsive email
semantics, source authoring, compilation, and preflight form a distinct task
environment over the same document.

This is an architecture and product-coherence decision. No usage telemetry
was available in this investigation, so it makes no claim about relative
workspace popularity or demand.

## Research and what it supports

Sources were checked 2026-09-27. Official documentation describes intended
product behavior; community threads are individual reports, not prevalence or
independent verification.

| Source | Finding | Decision supported | Limitation |
| --- | --- | --- | --- |
| [VS Code custom layouts](https://code.visualstudio.com/docs/configure/custom-layout) | Views can move among groups and reset to their locations. | Offer named move/reset actions alongside drag; keep recovery discoverable. | Code-editor precedent, not a graphics-editor specification. |
| [Brevo developer mode](https://help.brevo.com/hc/en-us/articles/360013295520-Use-the-developer-mode-for-advanced-customization-of-email-designs) | Email visual design, supported source editing, and live preview coexist in one authoring environment. | Keep Email as one specialized workspace; put source and preview near the visual editor. | Brevo edits its own YAML abstraction; Varve's stored source model differs. |
| [Stripo code editor](https://support.stripo.email/en/articles/6419682-what-is-the-code-editor-and-how-to-use-it) | HTML and CSS views are connected to visual selection, and selected source can be highlighted in the design. | Preserve Varve source maps and make authored source blocks discoverable. | Vendor documentation describes Stripo's implementation. |
| [Stripo imported HTML limitations](https://support.stripo.email/en/articles/13376041-how-to-adapt-my-own-html-code-to-stripo) | Imported arbitrary HTML does not automatically become fully editable by its visual builder. | Keep Varve's authored custom blocks distinct from generated HTML; state editing boundaries clearly. | Does not imply Varve can or should provide arbitrary HTML round-tripping. |
| [MJML validation](https://documentation.mjml.io/) | Email markup has structural validation and responsive components beyond ordinary canvas output. | Keep email preflight and responsive authoring integrated with Email. | Varve's compiler is its own implementation; no new dependency is proposed. |
| [Mailchimp community report](https://www.reddit.com/r/MailChimp/comments/1njag29/how_to_find_and_edit_code_blocks_in_use_in_the/) | Several users describe custom code blocks becoming invisible or hard to edit. | Show a persistent source-block list, including visually empty blocks. | Anecdotal, self-selected report; prevalence and current vendor status are unknown. |
| [Figma inspect guide](https://help.figma.com/hc/en-us/articles/22012921621015-Guide-to-inspecting) and [community feedback on the Inspect transition](https://forum.figma.com/ask-the-community-7/where-has-the-inspect-tab-gone-33758) | Current inspection paths vary by access and file settings. The guide documents generated snippets in Dev Mode and a separate “Copy as code” path in Design; the 2024 forum thread records confusion and complaints about losing convenient CSS inspection during the transition. | Keep Code as one clearly named, dockable panel that users can reveal from any workspace; route legacy Codegen actions to it, and expose output status and limits beside generated code. | The forum is anecdotal and describes a transition period; Figma's current guide also documents non-Dev-Mode inspection, so this is evidence of access-path complexity, not a claim that code inspection is universally gated today. |
| [Canva Logo Maker review](https://comparelogomakers.com/reviews/canva/), [Canva SVG requirements](https://www.canva.com/help/upload-formats-requirements-variantb/), and [Canva's Affinity-import behavior](https://www.canva.com/help/sharing-export-to-canva/) | The review reports no anchor-point editing in Canva's logo editor. Canva's help documents constraints on SVG size, profile, and construction; its Affinity-import page says imported Affinity work is a static image rather than editable source layers. | Keep Logo as a native-vector workflow inside Design: point/path editing, reusable brand-project controls, variants, and transparent vector/package export remain discoverable without switching to a separate Logo mode. | The editor review is secondary and the import limits are specific to Canva's formats; they do not establish the capabilities or limits of every logo product. |
| [Affinity community report](https://www.reddit.com/r/Affinity/comments/1wj6m5e/latest_update/) | Users report update workflows replacing custom studio layouts when defaults are overwritten. | Keep user layouts separate from built-ins; update defaults without silently replacing custom layouts. | Community report about a particular update, not an independently reproduced current defect. |
| [W3C dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | Dragging interactions need a single-pointer alternative. | Provide menu-based movement and sizing controls as well as drag. | Guidance must still be verified in Varve's actual UI. |
| [React state preservation](https://react.dev/learn/preserving-and-resetting-state) | Component state follows UI-tree position and can reset when a panel is reparented. | Own durable panel presentation state explicitly across dock moves/remounts. | Does not prescribe the persistence format. |

### Logo and Code migration contract

These findings support keeping both capabilities visible without making either
one a task-workspace selector. In Varve, Logo remains a registered singleton
panel backed by the document's native vector scene and logo-project metadata;
the Design toolbar, View menu, command palette, and `Ctrl+Shift+7` must all
lead to the same Logo tools. Code remains a registered shared panel; its menu,
command-palette, legacy Codegen, and `Ctrl+Shift+8` entry points must reveal
that same panel in the current workspace. The action keys follow the six
numbered workspace keys but never join the six-item workspace radio group.

The two compatibility preference slots migrate to explicitly named layouts
without overwriting Design settings. Applying one of those saved arrangements
must not silently change the active workspace. The editor should describe
generated code as an export/inspection result with its target and readiness
state, not promise arbitrary production-ready code. Logo and Code keep their
existing native detach-and-reattach behavior and panel state through docking.
These are acceptance requirements; this research table does not claim that
their implementation or all visual checks are complete.

## Repository and running-app baseline

The inspected checkout was `master` at `c4b3768cf185615813066ef4d2e32caca56d0253`,
168 commits ahead of `origin/master`. The shared tree had 335 changes across
other active work; no workspace implementation or documentation paths were
staged or dirty at inspection. `pnpm verify:plan` selected 320 changed files,
all JS packages and two Rust crates, and reported full-suite escalation due
workspace/toolchain/validation-infrastructure scope. This is a shared-tree
baseline, not validation of this work.

The running `localhost:1498/?isoTest=1` editor was inspected visually and via
its accessibility tree on 2026-09-27. It showed Design as the active workspace,
the canvas between Layers and Inspector, and the existing primary-window
detachment controls for Layers and Inspector. The Email inspector is currently
a tab within the general Inspector. A committed Email workspace screenshot
from 2026-09-24 also shows the Design inspector tab selected by default. The
running page and the historical screenshot are separate observations; the
historical image is not presented as a current-build capture.

Static inspection confirms the following ownership gaps to validate during
implementation:

- `WorkspaceMode` and navigation currently include eight modes; Logo and
  Codegen have separate built-in configurations and shortcuts.
- Email already has a document-level profile and semantics, a compiler,
  responsive browser preview, custom source blocks, source maps, preflight,
  and local export. Email itself does not enable or convert a document.
- Two pure dock-tree models coexist. The nested `workspace/dock` model has
  stronger registry validation, while the shell still renders fixed regions;
  the model is not yet the live dock layout.
- Existing named layouts capture workspace preference fields, not dock trees
  or toolbar/tab order. Native secondary windows currently render one panel
  per window through the existing transfer coordinator.
- Customization and layout-manager dialogs already exist and will be extended
  rather than duplicated.

### Confirmed issue matrix

| Severity | Reproduction and expected/actual | Root cause and scope | Regression evidence and status |
| --- | --- | --- | --- |
| P1 — workflow discoverability | Switch from Design to Email. Expected: Email authoring is the initial Inspector tab. Baseline actual: the Email workspace opens with Design selected; see the inspected pre-fix [Email workspace capture](../screenshots/workspace-dock-layout/email-light.png). | `PropertiesPanel` retained one panel-wide `activeTab`. Because Design's `properties` tab is also valid in Email, the default-tab fallback did not run after a mode switch. This affected shared Inspector state, not the document or authored email content. | Store the active tab per workspace, initialize Email from its configured `email` default, and migrate the former single value into the initial non-Email workspace. React component tests cover Design → Email → Design and legacy state; a current-build visual recapture remains pending. |

## Acceptance evidence to collect

For each milestone, record the exact baseline SHA, focused unit/property and
Playwright checks, actual browser or native environment, inspected screenshots
and any timing samples. Compare the same document, theme, viewport and device
scale before and after. Report web preview and native-window evidence
separately. Do not describe browser email preview as real-client validation.
