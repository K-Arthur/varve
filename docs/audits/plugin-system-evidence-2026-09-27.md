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
