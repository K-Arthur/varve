# Font and typography UX research — 2026-09-12

## Scope and method

This research was commissioned as part of the Varve font-system audit. It
compares documented behavior in Figma, Photoshop, Illustrator, InDesign, and
Affinity with the complaints that users repeatedly report around font
selection, previews, missing faces, replacements, permissions, and export.
Official product documentation was preferred. Community reports are included
only as anecdotal evidence of failure modes, not as a measurement of product
quality. The review was performed on 2026-09-12; product behavior and help
pages can change.

## Research update — 2026-09-14

The follow-up review checked the current first-party help pages again before
the next implementation pass. These details sharpen the acceptance contract:

- Figma's missing-font flow identifies the affected layers and distinguishes an
  unavailable font or style from a browser-helper or permission problem. Its
  conflicting-font guidance also warns that different versions can change
  text layout, reflow, and ligatures. Varve's recovery UI should therefore
  report the exact face and affected locations together, rather than reducing
  the state to a family-level warning.
- Illustrator's Find and Replace Fonts panel separates document, recent, and
  system scopes and exposes **Change** separately from **Change All**. Its
  missing-font panel separates adding a font, replacing it, and previewing a
  substitute while activation is still pending. Varve's replacement command
  follows the same explicit scope and one-transaction rule, with a visible
  preview before any multi-location change.
- InDesign's font browser documents real-time hover previews, classification,
  favorites, recent and activated filters, variable/OpenType indicators, and a
  switch to disable in-menu previews. This validates Varve's choice to keep
  navigation synchronous and previews bounded, and adds a concrete follow-up:
  expose a reduced-preview preference once the current performance budgets are
  measured on 1,000- and 10,000-family catalogs.
- Photoshop's current font browser groups variants under a family and exposes
  **Your fonts**, Adobe Fonts, variable-font, favorite, and similar-font
  filters. Varve should keep family grouping as presentation only: the active
  option and persistence key still need the exact artifact/member identity and
  instance axes.
- Figma's local-network-access documentation makes permission revocation an
  expected runtime state. The browser picker must preserve a document's
  requested face while clearly showing that local enumeration is unavailable;
  it must not silently substitute a same-name system face.

These observations do not change the scope of the 24-scenario matrix. They add
specific evidence requirements for affected-layer counts, replacement scope,
activation progress, preview disablement, exact-version diagnostics, and
permission revocation. The current master branch has the identity, exact-face
render/export plumbing, native handles, ambiguity protection, and toolbar
visual evidence. Document Fonts replacement UI, native restart proof, full
variable-axis persistence, and cross-platform WebView evidence remain open and
are listed as such in the matrix.

## What other products teach us

| Product | Useful behavior | Failure mode to avoid in Varve |
| --- | --- | --- |
| Figma | Separates local, uploaded, and shipped fonts; exposes an **Installed by you** filter; reports missing fonts beside the field and in a dialog; lets a user choose a replacement family/style and replace every affected text object. | A stale helper, duplicate version, or missing style can make an installed family appear missing. Figma documents that the browser helper is required for local fonts and that Linux/ChromeOS local-font support is limited. |
| Photoshop | Variable-font axes are edited in the Character panel and update text immediately. | Large font lists and preview generation are frequently reported as slow. A preview must be bounded and cancellable, and keyboard navigation must not wait for a preview. |
| Illustrator | **Find/Replace Font** scopes to Fonts in Document, Recent, or System and offers Change versus Change All. Missing-font recovery distinguishes Add Fonts, Replace Fonts, and preview-only substitutions. Its Retype workflow can identify a font from an image. | A global replacement without an explicit scope or impact preview is easy to apply accidentally. A substitute must remain visibly a substitute until the user commits it. |
| InDesign | Supports app/system/Adobe Fonts, background activation, a Find More workflow, hover previews, duplicate-family technology labels, and visible highlighting for substituted fonts. | Background activation and menu previews can make the UI feel stuck. Progress and failure need to be visible, and preview work must not block editing. |
| Affinity | The Character panel exposes collections including Missing Fonts and preserves character-level formatting. Resource Manager can locate, update, replace, and collect linked resources. | User reports and feature requests show that variable-font support and missing-font diagnostics can be unclear. Varve should expose axis support and exact face status instead of implying that a family label is sufficient. |

The common pattern is a split between discovery and commitment. A row can be
previewed without changing a document; applying a face is an explicit action.
The strongest products also make the affected text, scope, source, and
replacement consequence visible before a destructive-looking operation.

## Recurring user complaints and product requirements

### 1. Preview latency and blocked menus

Font menus become frustrating when every row waits for an image or browser
font load. Reports cover slow Photoshop and InDesign menus, preview failures in
After Effects, and arrow keys that do not advance reliably. Varve therefore
keeps search and hover local, virtualizes long lists, gives each preview a
bounded time and memory budget, and allows a text-only specimen while a face
is loading. Keyboard movement changes the active row synchronously; preview
work is secondary and cancellable. A user preference to reduce previews is a
reasonable follow-up once the current bounded path is measured.

### 2. Local-font permission and stale discovery

Figma's documentation makes the helper and permission boundary explicit, while
its support discussions show that users can still see missing fonts after
restarts, duplicate checks, and helper validation. Varve must show whether a
face is catalog-only, locally enumerated, stored, validated, main-thread ready,
or worker-adopted. **Allow local fonts** and **Refresh local fonts** are user
actions. Denial, unavailable APIs, and stale permissions have useful fallback
copy; they are not presented as an empty catalog.

### 3. Same-family versions and missing styles

A family name is not a face identity. A second file with the same family can
have different metrics, glyph coverage, or OpenType behavior. Varve keeps the
original artifact hash and collection member in `fontReference`, stores the
PostScript name and version as metadata, and reports version or missing-style
diagnostics. Selecting a family-only value clears an older exact reference;
selecting a registered face applies the family, style, weight, axes, and exact
reference together.

### 4. Replacement scope and reversibility

Illustrator's document-scoped replacement and Figma's affected-layer dialog
are useful models. Varve's Document Fonts and Select by Font work should show
the current page/document scope, exact face count, affected locations, and
layout-impact preview. The default excludes hidden and locked content; linked
stories, inherited styles, and component text are included in the usage index.
Replacement is one command transaction with restore-original support. A
broader search is a deliberate navigation choice, not a hidden side effect.

### 5. Variable fonts and authored intent

Photoshop and Figma expose variable behavior directly. The ordinary weight
control in Varve updates `wght` when that axis exists and retains custom axes
such as `wdth` and `slnt`. Unsupported axes are never shown as if they were
available. Mandatory shaping features, language, and rich runs remain part of
layout identity. A static face keeps the ordinary weight behavior without
inventing variation data.

### 6. Licensing, packaging, and portability

Technical embedding bits describe what a font technically permits; they do not
prove a source license. Varve keeps base embedding rights, `noSubsetting`,
`bitmapOnly`, and license provenance separate. Export preflight reports an
unknown license as unknown, verifies exact bytes before claiming bundling, and
offers live text, outlines, or raster alternatives when a face cannot be
embedded. Same-family artifacts and collection members remain separate in
clipboard and package dependency closures.

### 7. Image identification

Illustrator's Retype demonstrates the value of an image-to-font workflow, but
the action still needs a target and a review step. Varve bounds a transformed
crop, runs local comparison/classification and optional local OCR, displays
candidate confidence and model metadata, and lets the user create text, choose
an existing text target, or bookmark a candidate. Manual text entry remains
available. Changing the target cancels stale work; an identification result
never silently mutates an image.

## Varve decisions and implementation status

| Priority | Decision or feature | Status/evidence |
| --- | --- | --- |
| P0 | Exact artifact/member identity, local-only search and hover, explicit local-font permission, truthful missing-face states, and variable-aware ordinary weight control. | Implemented in the engine, browser, inspector, floating toolbar, contextual bar, and Logo panel. See [font frontend evidence](../audits/font-frontend-evidence-2026-09-12.md) and [font system architecture](../architecture/font-system.md). |
| P0 | Family-only editing clears stale exact identity; exact face selection applies all authored face metadata in one command. | Implemented; the inspector family-field regression is covered by `fontFamilyChanges` tests. |
| P0 | Virtualized, bounded previews with active-descendant and viewport containment checks. | Implemented and covered by the focused browser/toolbar visual runs. |
| P1 | Document Fonts and Select by Font usage index covering effective runs, inherited styles, linked stories, components, locations, and hidden/locked filtering. | Core indexing and replacement contract remain in progress. The next UI slice should expose current-page scope, exact-face counts, affected locations, and restore-original. |
| P1 | Per-face variable-axis inspection, preview-size/reduced-preview preference, version-conflict diagnostics, and explicit replacement impact preview. | Planned; the current axis adapter establishes the data path. |
| P1 | Native embedded WebKitGTK test plus Windows WebView2 and macOS WKWebView evidence. | Linux focused coverage is executable; Windows/macOS remain platform dependencies. |
| P2 | Transformed image crop, local classifier/OCR target selection, and cancellation-safe candidate actions. | Detection has bounded transformed decode, local adapters, optional recognized text, explicit existing-text target selection, one-step application, and a manual/new-text path; arbitrary OCR region overlays remain. |
| P2 | Portable collaboration transport for font dependency closures. | Payload contracts are prepared; live transport is outside this project. |

## Acceptance and evidence follow-up

The research changes the acceptance emphasis rather than replacing the
existing 24-scenario matrix. The next evidence pass should capture closed,
open, searched, filtered, expanded-face, variable-axis, missing-font, loading,
error, permission, replacement-preview, and image-crop states in light, dark,
high-contrast, narrow, 200% zoom, and DPR 1/2/3. It should inspect pixels and
measure clipping, then compare the rendered surface with a forced full redraw
where canvas reuse is involved. A matching screenshot alone cannot prove the
exact face or glyph run.

Performance targets remain warm picker open p95 <=150 ms, search p95 <=100 ms,
and ready-face preview p95 <=150 ms for 1,000 and 10,000-family catalogs.
Downloads remain limited to two concurrent jobs and face loads to three.
Platform evidence must label environment, exact `master` SHA, command, and
owner; pending Windows/macOS runs are not silently treated as passing.

## September 14 primary-source delta

The latest first-party checks add four implementation details that are easy to
miss when a font system is modeled only as a family list:

| Evidence | Implementation consequence for Varve |
| --- | --- |
| Figma's font browser separates **All fonts**, **In this file**, **Popular**, organization fonts, installed fonts, Google fonts, and variable fonts. It also previews a face on selected text and remembers the last filter for the session. | Keep filters as catalog projections, preserve the active face by exact artifact/member identity, and keep hover preview temporary. Persist the filter preference only at the UI-session level; never persist a preview as document formatting. |
| Figma documents conflicting versions as a cause of reflow and ligature failures and provides “Select all with same font” plus layout recomputation as recovery. | A same-family row must expose version/artifact state and affected locations. A replacement or repair action should offer an explicit reflow warning and a deterministic full-layout recomputation. |
| Illustrator's Find/Replace Font dialog distinguishes **Document**, **Recent**, and **System** sources and separates **Change** from **Change All**. Its missing-font dialog separately offers adding, replacing, or previewing. | Varve's Select by Font and Document Fonts actions should keep source scope, affected scope, preview, and commit as separate controls. A preview or temporary substitute cannot silently become a permanent replacement. |
| InDesign packaging runs preflight, can include hidden/non-printing assets by an explicit option, and rolls the package back when an error occurs. Adobe's font-packaging guidance also warns that license terms may forbid copying font files. | Export/package preflight must verify exact bytes and policy before claiming success, include hidden dependencies only through an explicit choice, and leave no partial package after failure. Technical embedding flags remain separate from license provenance. |
| Affinity community reports repeatedly distinguish temporary substitution from permanent replacement and ask for a direct replace action; another report describes variable-font kerning/export mismatches. These are anecdotal, not product guarantees. | Label “substitute for this session/export” separately from “replace authored runs,” and preserve the original request for later restoration. Add variable-axis and export parity to the visual/oracle checks rather than assuming a readable fallback is equivalent. |

These findings reinforce the current architecture: discovery, preview,
substitution, authored replacement, and export are separate operations. They
also give the quick toolbar a concrete usability rule: it should show the
effective mixed value and face capability synchronously, while any face preview
is a cancellable presentation override that cannot commit through a stale load.

## Sources

Official documentation:

- [Figma: Add a font to Figma](https://help.figma.com/hc/en-us/articles/360039956894-Add-a-font-to-Figma)
- [Figma: Missing font alert in Figma Design](https://help.figma.com/hc/en-us/articles/360039956994-Missing-font-alert-in-Figma-Design)
- [Figma: Manage conflicting fonts](https://help.figma.com/hc/en-us/articles/4403175325719-Manage-conflicting-fonts)
- [Figma: Local network access](https://help.figma.com/hc/en-us/articles/34458998159511-Local-network-access-in-Figma)
- [Figma: Variable fonts](https://www.figma.com/typography/variable-fonts/)
- [Figma: Browse and apply fonts](https://help.figma.com/hc/en-us/articles/360041308034-Browse-and-apply-fonts)
- [Figma: Explore text properties](https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties)
- [Figma: Use variable fonts](https://help.figma.com/hc/en-us/articles/5579502031511-Use-variable-fonts)
- [Figma: Use the actions menu](https://help.figma.com/hc/en-us/articles/23570416033943-Use-the-actions-menu-in-Figma-Design)
- [Adobe Illustrator: Preview, add, or replace missing fonts](https://helpx.adobe.com/in/illustrator/desktop/design-with-text/fonts-and-scripts/preview-add-or-replace-missing-fonts.html)
- [Adobe Illustrator: Find and replace fonts](https://helpx.adobe.com/illustrator/desktop/design-with-text/fonts-and-scripts/find-and-replace-fonts.html)
- [Adobe Illustrator: Fonts FAQ](https://helpx.adobe.com/illustrator/using/fonts-faq.html)
- [Adobe Illustrator: Find and apply fonts](https://helpx.adobe.com/illustrator/desktop/design-with-text/fonts-and-scripts/find-and-apply-fonts.html)
- [Adobe InDesign: Install and activate fonts](https://helpx.adobe.com/ie/indesign/desktop/fonts/install-and-activate-fonts.html)
- [Adobe InDesign: Preview and explore fonts](https://helpx.adobe.com/indesign/desktop/fonts/preview-and-explore-fonts.html)
- [Adobe InDesign: Package files for output](https://helpx.adobe.com/indesign/desktop/print/preflight/package-files-for-output.html)
- [Adobe Fonts: Package font files](https://helpx.adobe.com/fonts/web/getting-and-using-fonts/package-font-files.html)
- [Adobe Photoshop: Search for and apply a specific font style](https://helpx.adobe.com/photoshop/desktop/text-typography/select-manage-fonts/search-for-and-apply-a-specific-font-style.html)
- [Adobe Photoshop: OpenType variable fonts](https://helpx.adobe.com/photoshop/desktop/text-typography/select-manage-fonts/use-opentype-variable-fonts.html)
- [Affinity Designer: Character panel](https://s3-eu-west-1.amazonaws.com/affinity-docs/help/designer/en-US.lproj/pages/Panels/characterPanel.html)
- [Affinity Publisher: Variable fonts](https://affinity.help/publisher2/en-US.lproj/index.html?page=pages/Text/variableFonts.html&title=Variable+fonts)
- [Affinity Publisher: Resource Manager](https://affinity.help/publisher/en-US.lproj/pages/Advanced/resourceManager.html)
- [W3C: ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)

User and community reports (anecdotal):

- [Figma forum: local fonts suddenly missing](https://forum.figma.com/report-a-problem-6/my-local-fonts-are-not-working-anymore-suddenly-54488)
- [Figma forum: fonts no longer working](https://forum.figma.com/ask-the-community-7/fonts-no-longer-working-31524)
- [Adobe community: InDesign slow due to font previews](https://community.adobe.com/t5/indesign-discussions/indesign-2025-slow/m-p/15348235/highlight/true)
- [Adobe community: Find/Replace Font menu stalls](https://community.adobe.com/questions-671/find-replace-font-menu-extremely-slow-1616284)
- [Adobe community: Photoshop font dropdown slow](https://community.adobe.com/questions-712/photoshop-font-dropdown-menu-unoptimized-slow-1095934)
- [Adobe community: After Effects font preview errors](https://community.adobe.com/bug-reports-528/after-effects-font-dropdown-throws-cannot-create-font-x-repeatedly-freezes-on-scroll-survives-full-reinstall-1639469)
- [Adobe community: Photoshop font arrow-key navigation](https://community.adobe.com/bug-reports-711/p-can-t-scroll-through-fonts-using-arrow-keys-660059/index4.html)
- [Affinity community: variable-font support request](https://www.reddit.com/r/affinity/comments/1czaz5k)
- [Affinity forum: font substitution versus permanent replacement](https://forum.affinity.serif.com/index.php?/topic/137987-font-substitution-for-all-missing-fonts/)
- [Affinity forum: font manager replacement confusion](https://forum.affinity.serif.com/index.php?/topic/185303-font-manager-cant-find-the-font-and-wont-replace-the-missing-font/)
- [Affinity forum: variable-font kerning issue](https://forum.affinity.serif.com/index.php?/topic/202885-variable-font-support-kerning-issue/)

Community reports are useful for identifying failure modes, but they are not
treated as official product guarantees or statistically representative user
research.
