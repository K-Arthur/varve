# Local plugin API v1: evidence and failure-mode ledger

Date: 2026-09-27. This is a qualitative review of public issue reports, not a
prevalence estimate. Reports describe different hosts and products; they are
used to identify recoverable failure patterns, not to claim Varve shares their
root causes.

| Report and date | What users reported / reply or resolution | Confidence and transfer to Varve | Varve mitigation | Acceptance test |
| --- | --- | --- | --- | --- |
| [Figma: plugin list not loading on desktop](https://forum.figma.com/report-a-problem-6/plugin-list-not-loading-on-desktop-app-53619), 2026-05-05; follow-up 2026-05-06 | The reporter described a plugin list that stayed loading. Figma support said it was investigating the menu's loading state and suggested clearing the app cache, warning that unsaved offline changes could be lost. The next-day reply said the issue was believed fixed. | The report concerns a remote/catalog-backed list, not local package storage. The public reply does not establish how broadly the fix applied. A local manager should remain useful offline and avoid making cache deletion a recovery step. | Keep inventory and lifecycle operations local; show loading, empty, and error states separately; allow inspection, disable, removal, and recovery without a catalog. | With network disabled, reopen the manager and verify installed packages, grants, preferences, disable, and remove remain available. |
| [VS Code: settings file erased after update](https://github.com/microsoft/vscode/issues/125970), 2021-06-10 | A user reported a large `settings.json` being replaced after an Insiders update. The issue was closed as a duplicate of #126299. | This is evidence of reported settings loss, not a confirmed cross-window race. It motivates additive migration and transactional preservation; it does not show that IndexedDB itself prevents every storage failure. | Upgrade the existing plugin database additively, retaining package bytes, grants, enable preferences, panel preferences, and rollback copies. Store durable revisions and commit package/revision changes atomically. | Seed a v1 database, upgrade it, and compare every existing field and archive byte; inject aborts and verify the previous record remains intact. |
| [VS Code: workspace extension disabled with no way to enable it](https://github.com/microsoft/vscode/issues/304474), 2026-03-24 | The report says a workspace extension became globally disabled and the user could not find a UI route to re-enable it. The issue is closed as “not planned”; the public issue does not document a shipped fix. | A single report cannot establish frequency. It does make loss of a recovery route a concrete UX failure. | Keep failed, disabled, and incompatible installations in Settings → Plugins with a precise reason and reachable enable, retry, rollback, revoke, or remove action. Keep the manager outside plugin contributions and available in safe mode. | Force an incompatible and a failed installation; verify both stay visible, can be removed/recovered, and neither is silently enabled. |
| [vscode-gitblame: latest extension version fails to load](https://github.com/Sertion/vscode-gitblame/issues/193), 2026-03-02 | The reporter said an extension update left it stuck loading and reinstalling the prior version worked. The issue was closed without a maintainer reply in the public thread. | The report supports offering rollback; it does not establish that the update was automatic, the cause, or that Varve's local updates share it. | Preserve the previous validated archive during update, retain the current grants without expansion, and restore through the manager if the new package fails. | Install a working package, update to a failing one, restore the previous archive, and verify commands return with no additional grants. |
| [Figma: plugin list not sorted alphabetically](https://forum.figma.com/ask-the-community-7/problem-with-the-list-of-plugins-2769), 2023-08-28; Figma reply 2023-09-07 | A user objected to a recent/popular grouping and separate menu for the remaining plugins. Figma's reply said the list sorted by Recent and saved date and that alphabetical sorting had been requested and a sorting fix was being worked on. | One closed community thread records a concrete preference, not prevalence or the eventual product outcome. | Default to predictable A–Z ordering, offer recently installed sorting, and let people pin only packages they choose. | Install two packages in reverse alphabetical order; verify A–Z, recent sort, and persisted Pinned filter. |
| [Figma: plugin categorization and visual recognition](https://forum.figma.com/suggest-a-feature-11/categories-in-plugins-31396), 2021-01-27; later replies through 2025-03-26 | Users described a long list that was hard to organize, difficulty remembering what a plugin did, missing icons/screenshots, and friction after trying then uninstalling packages. A community manager said discovery and categorization were being considered; no shipped resolution is stated in the thread. | Long-running anecdotal feedback spans several interface versions. It is not a usability study; Varve has no community catalog or user-created folders, and at most 32 local packages. | Support an accessible image and concise description in review/cards, search descriptions and command names, preserve direct recovery actions, and add simple pins/status filters without building a marketplace. | Install both samples; screen-reader names expose thumbnail alt; search finds the description and command; pinned and status filters return truthful counts. |
| [Figma: saved plugins were hard to find and a toolbar surfaced only 25](https://forum.figma.com/ask-the-community-7/how-to-display-all-saved-plugins-in-the-new-interface-1176), 2024-12-30; Figma community reply 2025-03-07; follow-ups 2025-07 and 2025-08 | The user said only 25 appeared in a toolbar list; the reply explained other menu locations. Follow-ups said the menu lacked icons and keyboard search, and recently tested plugins cluttered the toolbar. | The reply identifies an intentional toolbar limit and alternate routes, not missing saved data. Later users still report discoverability problems; transfer is limited to avoiding hidden inventory and making the complete manager searchable. | Show every installed record in the manager up to Varve's explicit 32-package ceiling. Keep Pinned separate from All and Needs attention, with search, result counts, and thumbnails. | Use a fixture inventory at its supported maximum; confirm every record is reachable by scrolling, filtering, and search, without silent truncation. |
| [Photoshop: Creative Cloud Manage Plugins page did not load](https://community.adobe.com/questions-602/manage-plugins-page-doesn-t-load-in-creative-cloud-desktop-so-i-can-t-update-plugins-1559534), 2026-04-29; more reports 2026-04-30 and 2026-06-12 | A user reported the Manage Plugins page ended with “Something went wrong,” and the recovery button returned to Featured Plugins; manual installation hung. A community expert suggested reset/repair/reinstall. The original user later said repair, reinstall, and reboot still left them unable to reinstall or use the prior version. | This is one Creative Cloud service/app incident thread. It does not show that Photoshop generally fails, nor that Varve has the same failure. | Keep package inventory and core recovery local and offline; keep rollback, disable, and removal in the same manager rather than requiring a catalog page. | Disable network after installing a package; reload the manager and verify search, inspection, disable, rollback, and removal remain available. |

## Product patterns reviewed

[Figma's plugin guide](https://help.figma.com/hc/en-us/articles/360042532714-Use-plugins-in-files)
organizes discovery around Recent, Saved, and Community surfaces. The Figma
threads above show why a local, installed-only Pinned filter and an explicit
sort choice can be useful: users described losing their curated subset among
recent tests, wanting alphabetical ordering, and needing a way to recognize a
plugin without reopening its details.

[Photoshop's current Marketplace guide](https://helpx.adobe.com/photoshop/using/photoshop-marketplace-plugins..html)
uses searchable and filterable plugin cards, a Manage Plugins surface for
disable/uninstall, and a Plugins menu launchpad. Varve adopts the visual card,
search, and always-reachable management ideas where they fit its local package
workflow. It does not copy the cloud catalog, account sign-in, Get flow, or
Marketplace trust cues. Adobe also documents that disabling or uninstalling a
Marketplace plugin removes its customizations; Varve keeps the user's
presentation-only pins through disable/update and removes a pin only with the
installation.

These are reference patterns, not claims that Varve has Marketplace parity.
The complaint reports are individual accounts; they have no prevalence
denominator, and some describe intended limits or later replies rather than a
confirmed unresolved defect. We target only the transferable friction that
Varve can address in its bounded, offline manager.

## Security evidence

The [WebAssembly GC proposal overview](https://github.com/WebAssembly/gc/blob/main/proposals/gc/Overview.md)
describes GC-managed objects and references as a separate Wasm feature area;
linear-memory maximums therefore do not bound all allocations available to a
module that can use GC types. API v1 now rejects recursive, aggregate, subtype,
and reference-valued function types before compilation, and checks the small
numeric ABI before instantiating a worker. This is a feature restriction, not
a claim that the Worker or browser process has a total memory cap. The host's
imported linear memory is capped at 256 pages (16 MiB); engine, Worker, and
process overhead remain outside that cap and are reported separately.

## Scope and limits

These examples are intentionally small and public. They do not prove a common
failure rate, independent security review, or compatibility with Figma, VS
Code, UXP, or other plugin APIs. The practical response is an explicit local
boundary, durable user-owned state, visible recovery, and acceptance tests
that reproduce each failure class. Browser tests do not replace packaged
WebKitGTK, WebView2, or WKWebView validation.
