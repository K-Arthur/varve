# Font acceptance matrix — 2026-09-09

Updated 2026-09-10. This preserves the original 24 acceptance scenarios, in their
original order. The earlier matrix substituted narrower unit checks and marked
some end-to-end capabilities implemented without sufficient evidence. Those
completion labels are superseded. A component test is evidence for that component,
not certification of a full scenario.

| # | Original acceptance scenario | Status | Evidence / next executable check |
| --- | --- | --- | --- |
| 1 | A bundled font appears, previews, applies, renders identically on main thread and worker, exports, and survives reopen offline. | Open | Three required licensed variable-font artifacts verify metrics, axes and original-byte identity; offline render/export/reopen oracle pending. |
| 2 | Desktop enumerates an installed family with several faces; selecting a face preserves its exact identity, weight, style, and stretch after restart. | Open | Native IPC envelope corrected; exact handles, face identity, and native restart proof pending. |
| 3 | Browser local-font access succeeds, is denied, is unsupported, and is revoked; each state has a clear next action. | Open | Permission request helper exists; deliberate UI, revocation, and import fallback proof pending. |
| 4 | Two different font files with the same family name coexist. The selected one remains selected across save/reopen and the other is not removed by uninstall. | Open | Hash model exists; native family storage and runtime aliases still collapse artifacts. |
| 5 | A TTC/OTC exposes distinct members and selecting one does not collapse to the first file member. | Open | Header/offset checks exist; WOFF2 collection-entry identity now matches single-face parsing. Independent multi-member fixtures, picker/member import and reopen proof pending. |
| 6 | A variable font named instance and custom axes render, copy/paste, collaborate, export, undo/redo, and reopen without clamping drift. | Open | Axes persist in model; canonical shaping and full dependency round trips pending. |
| 7 | Real and unavailable weights/styles produce accurate controls; synthetic styling is blocked or clearly disclosed according to product policy. | Open | Hardcoded toolbar/inspector weights and synthetic italic remain to be replaced. |
| 8 | Opening or hovering the picker creates no undo entry. Escape restores the exact prior formatting. Click creates one entry. | Open | Escape/portal repair and 27 inspected theme/DPR/narrow captures committed in `e4508d4e7`; presentation-only preview and one-step undo proof pending. |
| 9 | Formatting a substring changes only that range. Formatting several layers changes each intended property without flattening their other rich runs. | Open | Run splitting/insertion preserve inherited style links in `747d120d4`; toolbar still writes node properties and the shared range/caret adapter remains pending. |
| 10 | A font change recomputes wrapping, autosize, overset, caret, selection, path text, and layout exactly once per logical commit. | Open | Family loading invalidation exists; exact instance geometry and logical-commit oracle pending. |
| 11 | A dynamically downloaded/project font renders on the worker or causes a synchronous main-thread path; no stale or fallback bitmap is reused. | Open | Blob CSS bridge exists; revision-specific worker adoption and pixel oracle pending. |
| 12 | A missing family, missing face, missing glyph, corrupt file, version mismatch, and restricted font each produce a distinct state and recovery action. | Open | Resolver has partial statuses; complete capability/preflight and recovery UI pending. |
| 13 | Missing-font replacement covers top-level text, rich runs, linked stories, and styles in one undo transaction; original references remain recoverable. | Open | Existing family replacement is insufficient; shared effective usage index and provenance pending. |
| 14 | Restoring an exact original font later does not silently rewrite the document; the user previews and confirms restoration. | Open | Explicit restoration preview pending; loading must remain presentation-only. |
| 15 | Select by Font respects current-canvas scope, inherited/run-level fonts, hidden/locked policy, and explicit cross-page navigation. | Open | Usage helpers exist; effective inherited/rich scope and navigation assertions pending. |
| 16 | Fontsource install shows progress, cancels cleanly, retries after offline failure, verifies the artifact, survives restart, and removes only the chosen face. | Open | Queue cancellation repairs exist; durable journal, exact uninstall, integrity and offline E2E pending. |
| 17 | An Arabic/Devanagari/CJK/emoji fixture reports coverage accurately and preserves mandatory shaping, grapheme caret behavior, BiDi order, and fallback provenance. | Open | Parser coverage fixes exist; multilingual shaping and caret oracle pending. |
| 18 | A color font renders or reports a precise unsupported-path state; it never silently becomes monochrome in only one renderer. | Open | Color format metadata exists; per-render-path capability and parity proof pending. |
| 19 | Import and clipboard tests preserve family, face, axes, features, rich runs, and missing-font provenance for every supported format. | Open | Optional fontReference schema exists; per-format/rich-run dependency closure evidence pending. |
| 20 | PDF/SVG/package export either embeds, subsets, outlines, rasterizes, or blocks according to the explicit user choice and verified policy, with no false success. | Open | Package writes font entries; exact preflight, per-run outline and policy verification pending. |
| 21 | The picker handles thousands of families within declared latency/memory budgets and remains keyboard-accessible under virtualization. | Open | Mounted active-option behavior and removal of the 120-result cap tested in `e4508d4e7`; 1k/10k measured budgets pending. |
| 22 | Image font identification uses the selected crop, handles cancel and low confidence, previews candidates, and applies to an explicit text target or creates editable text. | Open | Current image UI lacks crop/classifier/comparison dependencies and a useful explicit text target. |
| 23 | Save/reopen, undo/redo, autosave recovery, document switching, and two simultaneous documents do not leak project fonts or picker state across documents. | Open | Document lifetime isolation, migration restart and autosave recovery E2E pending. |
| 24 | Installing or removing an OS font while the app runs refreshes or exposes an explicit Refresh action without corrupting the current document. | Open | Native request corrected; explicit Refresh workflow and native proof pending. |

## Evidence ownership

Linux Chromium owns browser interaction, canvas and screenshot evidence. Linux
Tauri/WebKitGTK owns native enumeration, exact-file reads and restart checks.
Windows WebView2 and macOS WKWebView need native CI/manual runs on those hosts;
the next check is the font-specific embedded WDIO spec once added. Portable
collaboration payloads are in scope; live transport is excluded.

See the [dated audit](./font-system-audit-2026-09-09.md) for historical observations
and the [remaining-work plan](../plans/font-system-remaining-2026-09-10.md) for
implementation order and gate ownership.

Inspector and website captures, validation failures and remaining platform checks
are in the [integration evidence log](./font-integration-evidence-2026-09-10.md).

Required fixture provenance, the corrected OS/2 audit finding, and the reproduced
WOFF2 identity mismatch are in the [parser evidence log](./font-os2-metrics-evidence-2026-09-10.md).
These bounded checks do not close any full acceptance scenario.
