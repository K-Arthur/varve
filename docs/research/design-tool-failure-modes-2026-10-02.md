# Design-tool failure modes and Varve responses (2026-10-02)

Date: 2026-10-02

This is a complaint-informed positioning note, not a market survey. Forum
threads, review sites, and vendor help pages are anecdotal evidence of pain,
so they are useful for identifying failure modes and acceptance tests —
never for claiming prevalence.

It extends [`design-tool-failure-modes-2026-09-21.md`](design-tool-failure-modes-2026-09-21.md)
with the 2025–2026 pricing, lock-in, AI, telemetry, signing, and licensing
complaints that shape how Varve's own promises are phrased. The claim
consequences are recorded in the
[positioning and discovery brief](../marketing/positioning-and-discovery.md).

## Failure modes and realistic responses

| Failure mode | Representative public evidence | What Varve can realistically do (and already does) | Trap to avoid |
| --- | --- | --- | --- |
| Subscription pricing, seat mechanics, and cancellation friction | Figma's March 2025 seat/billing rework and admin-approval share flow ([help centre](https://help.figma.com/hc/en-us/articles/27468498501527), [forum](https://forum.figma.com/product-updates-3/updates-to-our-pricing-seats-and-billing-experience-19448)); Adobe's early-termination fee underpins the [DOJ complaint](https://www.justice.gov/usao-ndca/media/1356226/dl?inline=); Canva billing complaints on [Trustpilot](https://www.trustpilot.com/review/canva.com). | Keep a real Community Edition with no subscription, no seats, and no cancellation flow. State the committed scope — free, no feature paywall, and existing free capabilities not moved behind a paid tier ([COMMERCIAL.md](../../COMMERCIAL.md)). | Unqualified “free forever”. It is unfalsifiable and is the exact pledge later reversed around Affinity, Sketch, and Clip Studio. Name the edition and the commitment instead. |
| Cloud lock-in, forced uploads, offline that is not offline | Canva's December 2025 outage and its [7-day offline-sync limits](https://www.canva.com/help/fix-offline-sync-errors/); Figma's [offline is a warm cache](https://help.figma.com/hc/en-us/articles/360040328553) with device-local changes; Adobe licence phone-home lockouts. | Documents are files on disk; there is no server that can be down. Keep save/recovery state visible and keep every network feature explicit. Under-claim the WASM demo: its data lives in browser storage, not a file. | Implying hosted sync or recovery because collaboration scaffolding and user-configured providers exist. Also “nothing ever leaves your machine” — untrue once a model download, update check, or measurement is opted into. |
| File-format lock-in and export fidelity | Figma's `.fig` is [proprietary and may change](https://help.figma.com/hc/en-us/articles/8403626871063); Affinity v3 [cannot save back to v1/v2 files](https://arstechnica.com/gadgets/2025/10/canvas-new-affinity-app-is-free-to-use-but-locks-ai-features-behind-a-subscription/); Figma forum reports of [phantom SVG rects](https://forum.figma.com/report-a-problem-6/stop-adding-rects-to-svgs-that-don-t-exist-in-the-design-36808) and [missing layers on batch export](https://forum.figma.com/report-a-problem-6/layers-missing-after-export-50178). | A versioned `.varve` schema that migrates older files on open, a published export-fidelity matrix, and a converter in the same release if a break is ever unavoidable. | “PSD/AI/IDML-compatible” or “open format” without linking the schema. Beta format churn stated without a migration commitment. |
| Performance: lag, memory blow-up, GPU instability | Figma's own [guidance to split large files](https://forum.figma.com/ask-the-community-7/how-do-i-handle-large-figma-files-that-are-becoming-too-slow-or-laggy-47583); Illustrator slowness on high-end hardware ([Adobe community](https://community.adobe.com/questions-652/serious-lag-and-bugs-in-illustrator-2025-29-8-1-despite-high-end-hardware-817736)); Krita Flatpak crashes and Qt6 canvas regressions ([Krita Artists](https://krita-artists.org/t/crashing-on-latest-flatpak-build-upon-opening-any-image-or-workspace/140987)). | Canvas2D stays the default with GPU paths opt-in and fallback; regressions in the replay hot path are treated as bugs ([AGENTS.md](../../AGENTS.md)); the benchmark envelope is published rather than an adjective. | “Blazing fast” or “runs 10k shapes smoothly” without hardware and document conditions. Shipping a benchmark table and letting it go stale. |
| AI overreach, unwanted generation, training fear | Adobe's 2024 Terms-of-Use backlash over content access ([The Verge](https://www.theverge.com/2024/6/7/24173838/), [Adobe response](https://blog.adobe.com/en/publish/2024/06/10/updating-adobes-terms-of-use)); canva AI-slop and credit-burn complaints. | Assistive features (trace, enhance, background removal, object selection) are opt-in and run on-device; no generative text-to-image layer sits over the canvas; no Varve-hosted inference. Say what each optional cloud step is when it exists. | Any blanket “AI-free” or “no AI” badge — tracing, upscaling, and on-device models are AI features. |
| Update nags, forced updates, telemetry | Adobe's [non-closeable update popups](https://community.adobe.com/questions-712/adobe-forcing-me-to-update-from-2024-how-do-i-stop-this-popup-1175276) and enforcement of auto-update; `LogTransport2` shutdown hangs; Figma's [forced UI3 migration](https://forum.figma.com/share-your-feedback-26/forcing-ui3-on-us-is-a-huge-mistake-let-us-choose-april-30-39150). | Updates are consent-first, verified before install, and never block or restart the canvas ([privacy policy](https://varve.studio/about/privacy)). No analytics or crash reporting by default. | “Zero telemetry” while an opt-in aggregate-analytics path exists. Say “none by default, opt-in only, and here is what it sends”. |
| Accessibility and internationalization | Figma's canvas is not exposed to screen readers ([LinkedIn account](https://www.linkedin.com/posts/marianavery_every-single-day-im-asked-about-the-accessibility-activity-7381740367207104513-8bM3)); InDesign requires a separate Middle East build for RTL and Illustrator's RTL controls are installer-dependent ([InDesign UserVoice](https://indesign.uservoice.com/forums/601021/suggestions/50818748)). | BiDi and complex-script shaping live in the text engine rather than a locale-specific build; the editor is keyboard-complete. Publish the canvas screen-reader gap rather than hiding it. | “Fully accessible” or “WCAG 2.2 AA compliant”. The token gate is not a product-conformance audit, and mapped text layout is not the same as an accessible application chrome. |
| Cross-platform inconsistency and signing trouble | No official Figma desktop for Linux ([forum](https://forum.figma.com/suggest-a-feature-11/official-linux-support-17559)); unsigned Tauri apps showing macOS “is damaged and can't be opened” ([tauri-action #824](https://github.com/tauri-apps/tauri-action/issues/824)); Linux packaging being the stability variable (Krita's official AppImage resolving most issues). | Linux is a first-class native target with AppImage/deb/rpm; per-platform maturity and signing state are tableated honestly, with the macOS bypass documented. | “Available on Linux, macOS, and Windows” with no maturity distinction while two platforms are unsigned. |
| Forced collaboration vs. no collaboration | Figma seat/billing blocking mixed-plan collaborators and 24-hour open sessions ([forum](https://forum.figma.com/share-your-feedback-26/i-have-a-paid-professional-account-and-my-partner-has-another-one-but-we-can-t-work-together-48854)); “too many cooks” workflow complaints. | Single-player by default: no seats, no per-collaborator billing, sharing is sending a file. Real-time multiplayer is explicitly not shipped. | Any “collaboration” bullet that implies live co-editing or presence. |
| Surprise licence changes and re-licensing | The Affinity→Canva “free forever” pledge followed by a mandatory account and v2 end-of-life ([Ars Technica](https://arstechnica.com/gadgets/2025/10/canvas-new-affinity-app-is-free-to-use-but-locks-ai-features-behind-a-subscription/)); the CLA-based re-licensing pattern (Redis, HashiCorp, Elastic). | FSL-1.1-MIT is stated as source-available, not open source; each release converts irreversibly to MIT after two years; contributions use DCO sign-off, not a relicensing CLA. | Calling the application “open source”. That single mislabel invites the exact rug-pull critique, and it is factually wrong under the OSI definition. |

## Top actionable wording opportunities

1. **Ownership, made verifiable.** Combine the checkable mechanisms: no
   account, files on disk, a versioned schema with migrations, and
   FSL-1.1-MIT's automatic MIT conversion with no CLA. Mechanism beats
   promise.
2. **“There is no server to be down.”** The strongest true local-first
   claim; guard it by under-claiming the browser demo's storage.
3. **Optional local assistance, with generation named precisely.** Varve does
   not train models on user documents. Assistive tools coexist with explicit
   mask-guided Fill/Remove and bounded desktop promptless Expand; model
   downloads require the user's choice. Prompt-conditioned generation remains
   gated, browser AI-quality Expand is pending qualification, and there is no
   shipped hosted text-to-image service. Avoid “AI-free” and blanket
   “no generative AI on your work” promises. See the
   [current capability boundary](../architecture/generative-editing-system.md#current-capability-boundary).
4. **No nags, no forced updates, no silent pings.** Distinguish “none by
   default” from “zero”.
5. **Linux genuinely first-class, paired with honest signing status.**
6. **A measured performance envelope, not an adjective.**
7. **Single-player by default, no seats.**
8. **Complex-script and BiDi text in the same install** — scoped to text
   layout, with screen-reader status disclosed separately.
9. **A file-format stability and migration guarantee.**
10. **A one-page no-rug-pull policy**: DCO instead of a CLA, no free
    capability moved behind a paywall, and no “free forever” slogans.

## Self-audit items this research raises for Varve

These are current repository facts that sit adjacent to the complaints above.
None is a defect on its own; each becomes a liability only if the public
wording gets ahead of the engineering. They are listed so future copy changes
check them first.

- The `.varve` format can still change between releases. The migration
  commitment, not the slogan, is what keeps this defensible.
- Windows and macOS installers are unsigned; the download page states it.
- The application is source-available (FSL-1.1-MIT), not OSI open source.
- The on-device models mean “no AI” is never a truthful claim.
- The browser demo persists in browser storage, not as a user-visible file.

## Release acceptance follow-up (2026-10-06)

Additional first-person reports reinforce specific release checks, rather than
supporting claims that Varve cannot lose work or that another application is
generally unreliable:

- An Affinity Designer user reported a corrupted project despite repeatedly
  saving ([user report](https://forum.affinity.serif.com/index.php?/topic/162216-the-file-appears-to-be-corrupted-in-affinity-designer/)).
  Varve's acceptance criterion is a completed destination write plus save,
  reopen, recovery, and published-file migration coverage. Recovery is a safety
  net; users should still retain an original copy before a format upgrade.
- Figma users report an indefinite saving state and fear of discarding changes
  ([user discussion](https://forum.figma.com/ask-the-community-7/figma-is-saving-closing-your-app-will-discard-changes-11855/index1.html)).
  Keep Varve's Saving, Modified, Saved, and Save failed states explicit. Do not
  imply that a browser demo's local storage is a durable file backup.
- AppImage's own [FUSE troubleshooting guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)
  documents a portability boundary that a one-file download does not remove.
  Keep FUSE2, the extraction fallback, system WebKitGTK, architecture, and the
  supported glibc floor visible before installation. Qualification must exercise
  the actual packaged app, not only the development server.

The 0.5.0 release already includes the save/recovery and schema migration
contracts above. Publication must preserve its beta label, known limitations,
actual signing/updater state, and generated download sizes/checksums. Refresh
release data only from verified published artifacts; do not pre-advertise a
draft or replace installer evidence with a successful browser test.

## PDF export acceptance follow-up (2026-10-06)

Firsthand [Illustrator blank-PDF reports](https://community.adobe.com/questions-652/adobe-illustrator-export-to-pdf-is-blank-1550334) began February 17, 2026 and include a further report on October 2. One participant could export PNG but not PDF; another used printing as a workaround. These reports establish an experienced failure, not one verified common root cause or the current status of every Illustrator build.

Release implication (our inference): validating PNG or the PDF file structure cannot establish that a user's PDF contains their artwork. Each advertised format needs its own decoded-content checks.

Varve's actual installed Windows/Linux export inspection found an 800-byte PDF whose page/header/EOF were valid but whose source artwork was replaced by a tiny cyan fallback. Repair commit `15ce7b872` fixes the native manifestJson argument and hidden raster-scale leakage into PDF dimensions. A real-browser boundary test captures the embedded image and authored 104-by-80 dimensions; the actual Rust engine produced the corrected PDF, passed the committed PDF.js pixel/dimension oracle, and was independently rendered/viewed with Poppler. Installed-production qualification requires PNG, SVG and PDF separately across all five release targets. The defective native file is a negative regression fixture; a real repaired native PDF is a positive fixture.

Coverage boundary: this embedded-image acceptance fixture does not establish universal PDF transparency, every third-party viewer, ICC/prepress, or arbitrary multipage compatibility. The earlier native bundles remain unsuitable for publishing the fix; final certification and newly built installed-platform outputs are still pending when this note was written.

### Workspace panel recovery and restart acceptance (2026-10-06)

In a [December 2023 Affinity forum report](https://forum.affinity.serif.com/index.php?/topic/195749-how-to-reset-workspace/), a user could no longer restore their panel arrangement and tried reinstalling and deleting app data. The reply directed them to named studio presets. An [earlier panel-recovery thread](https://forum.affinity.serif.com/index.php?/topic/52475-bottom-right-corner-menu/) describes losing the History group, with reloading failing to bring it back; the response explains the panel menu and studio reset. These are user reports of recovery difficulty, not evidence that every current Affinity build has a persistence defect. The search index exposed the dated primary forum text; direct fetches returned HTTP 403 during this follow-up, so no newer resolution status is asserted.

The acceptance inference is that customization must be verified after a fresh editor boot, and recovery should be available through the visible panel controls without reinstalling or deleting user documents. Varve's candidate exposed a distinct local defect: saved History and Timeline overrides were overwritten by hardcoded false values during EditorProvider initialization. Commit `83eecbb4767a0cd17d9e84d3439a8e255251758b` removes those overwrites. Six mounted-provider cases cover explicit true/false preferences and per-mode isolation; the real browser case clicks the visible controls, creates a new document after a full page navigation, and requires both panels to return. Both resulting screenshots were inspected. The 12-lane affected validation passed; exact-source hosted release certification remains separate.


### Fit target and visible viewport acceptance (2026-10-07)

An [Illustrator UserVoice report](https://illustrator.uservoice.com/forums/601447-illustrator-desktop-bugs/suggestions/20558788-paste-occasionally-does-not-put-the-pasted-art-in) describes unexpected centering after Fit Artboard. Adobe marked it fixed in 2019; its November 10, 2025 response acknowledges subsequent reports. The discussion also distinguishes the view center from the artboard center. This does not establish a defect in every current build. Adobe's [viewing documentation](https://helpx.adobe.com/africa/illustrator/using/viewing-artwork.html) distinguishes fitting an artboard from zooming to selection.

Our acceptance inference is to name the fitting target and measure its actual visible placement. Varve reproduced a separate failure: a Design Canvas had no Publishing Page for the old action to fit. A further real-browser portrait case found trim hidden approximately fifteen pixels beneath the floating toolbar. The repair fits owned canvas artwork or placed publishing trim and reserves clear canvas space. Browser tests start from changed zoom, require actual geometry, and retain screenshots; rotation and unrelated surface ownership have direct geometry coverage. This changes viewing, not document or paste placement.
