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
| [Chrome keyboard shortcuts](https://support.google.com/chrome/answer/157179?hl=en) | On Windows/Linux, Chrome reserves `Ctrl+Shift+J` for Developer Tools, `Ctrl+Shift+B` for the bookmarks bar, and `Ctrl+Shift+M` for profile switching. On macOS, Chrome uses `Command+Shift+J` for Downloads and reserves the corresponding B/M browser controls. These overlap Varve's Code, Inspector, and Minimap toggles in the browser route. | Keep the established bindings in the desktop app; document `Ctrl/Command+Shift+8` and View-menu actions as browser paths. | Browser behavior does not change the native-app bindings; the menu actions remain discoverable. |
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
| P1 — workspace-key order and label drift | Reported: workspace numbers skipped or disagreed with the switcher order. Expected: Design, Print, Draw, Photo, Motion, Email map to 1–6 in that order; Logo and Code follow as actions 7–8. | Display code had to resolve labels from the same shortcut registry that dispatches keypresses. Static documentation also listed the retired letter shortcuts without the current full mapping. | Fixed in `0805eb0`: the switcher now shows registry-derived 1–6 markers in radio order; Logo 7 reveals Design tools, Code 8 reveals the shared panel, and `Ctrl+Shift+J` remains the desktop toggle. Component and Playwright coverage assert ordered keys and workflow routes. Current help and website docs state the six-number sequence and identify the old `D/P/R/I/M` meanings, including Toggle Minimap. |
| P2 — browser-reserved panel chords | On Windows/Linux, the app's desktop panel bindings overlap Chrome controls: `Ctrl+Shift+B` for bookmarks, `Ctrl+Shift+M` for profile switching, and `Ctrl+Shift+J` for Developer Tools; `Ctrl+Shift+I` is also reserved while Varve assigns it to Invert Selection. On macOS, `Command+Shift+J` opens Downloads in Chrome. | The same shortcut registry serves desktop and browser hosts, but browsers and operating systems claim reserved chords before page handlers. | Keep existing desktop bindings; docs now direct browser users to `Ctrl/Command+Shift+8` for Code and the View menu for Inspector, Minimap, and other actions. Verified against [Google Chrome's shortcut list](https://support.google.com/chrome/answer/157179?hl=en). |
| P1 — workflow discoverability | Switch from Design to Email. Expected: Email authoring is the initial Inspector tab. Baseline actual: the Email workspace opened with Design selected; see the inspected pre-fix [Email workspace capture](../screenshots/workspace-dock-layout/email-light.png). | `PropertiesPanel` retained one panel-wide `activeTab`. Because Design's `properties` tab is also valid in Email, the default-tab fallback did not run after a mode switch. This affected shared Inspector state, not the document or authored email content. | Fixed in `a1daa1059`: Inspector tabs are stored per workspace, Email initializes from its configured `email` default, and the former single tab migrates to the initial non-Email workspace. Targeted component tests pass; a fresh dark live-browser capture at 936×908 CSS px showed Email selected. The committed light workspace captures remain at `../screenshots/workspace-dock-layout/email-light.png`. |
| P1 — consolidated workflow access | From Email, use View → Workspace → Show Code Panel. Expected: reveal the shared Code surface while Email remains active. The alternate View → Panels → Code Panel item toggles the same singleton. From Email, use View → Workspace → Show Logo Tools in Design. Expected: switch to Design and reveal its Logo panel. | The workspace submenu lists Design through Email as 1–6 followed by Logo 7 and Code 8; these actions are separate from the six workspace radio items. The existing panel toggle remains `Ctrl+Shift+J` in the desktop app. | Verified in the live dark browser at `localhost:1498/?isoTest=1`: the Show Code Panel command revealed Code while Email stayed selected; View → Panels opened it too; the Logo command switched to Design and rendered the Logo panel. Targeted Playwright verified `Ctrl+Shift+6`, `Ctrl+Shift+8`, then `Ctrl+Shift+7` plus `Ctrl+Shift+8` in Design. The browser screenshot was inspected; see the test's Email and Design screenshots under `test-results/workspace-consolidation-verified-2026-09-27/`. |
| P1 — Email Output reachability | Open Email authoring and choose Email Output. Expected: Email Output is its own dockable singleton, with generated output and saved source blocks reachable without losing Email authoring controls. Actual baseline: Email Output was rendered conditionally inside the Email Inspector tab, so its registered panel identity did not correspond to an independently placeable surface. | The `emailOutput` registry entry and visibility preference existed, but the shell did not mount it. `EmailPanel` rendered it as nested Inspector content instead. | Moved `EmailOutputPanel` into the docked shell surface. The built-in Email layout groups Email Preview and Email Output below the canvas with Preview selected; older layouts add Output beside Preview when completing their dock tree. Twelve focused unit tests, editor typecheck, E2E typecheck, and the lease-wrapped Email controls Playwright test pass. The inspected light capture is [`email-output-light.png`](../screenshots/workspace-dock-layout/email-output-light.png); it shows Email authoring selected, the Preview tab active, and Output available as a sibling tab. |
| P1 — responsive panel reachability | At a 936×908 CSS-pixel viewport, open Code in Email, then show Logo Tools in Design. Expected: project panels within the shell when registered desktop minimums cannot fit, retain a 320 CSS-pixel central canvas, and keep Email Preview below the main panel row. Actual baseline: Code covered the canvas; Logo extended beyond the right viewport edge. | The original defect used the whole `canvas` grid cell for Code and left the Logo grid track at 340 px until the 899 px media query. Dock integration then exposed a second defect: compact-fallback CSS still looked for absolute positioning on `.editor-canvas` after the new geometry moved to `.editor-shell__canvas-dock`, so valid desktop layouts were treated as drawer fallback. | Reproduced and visually inspected before the fixes in the live dark browser. The fallback now targets the geometry-owning wrapper; the six-workspace geometry E2E passes with Layers and Inspector visible beside the canvas. The 936×908 Chromium Logo/Code regression and strict marketing capture confirm both project panels stay inside the shell, the clear canvas width is at least 320 CSS px, and Email Preview stays below the Code surface. The responsive regression also passes with the Layers drawer opened and dismissed by Escape, and confirms the Email authoring tab is selected. The six-workspace geometry E2E waits for the Email authoring tab before capture; its [Email image](../screenshots/workspace-dock-layout/email-light.png) shows Email selected and the preview beneath the canvas. The inspected Logo/Code capture is [`workspace-shared-workflows-light.png`](../screenshots/product/workspace-shared-workflows-light.png), now registered in the website manifest. |

## Acceptance evidence to collect

For each milestone, record the exact baseline SHA, focused unit/property and
Playwright checks, actual browser or native environment, inspected screenshots
and any timing samples. Compare the same document, theme, viewport and device
scale before and after. Report web preview and native-window evidence
separately. Do not describe browser email preview as real-client validation.
