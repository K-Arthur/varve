# Font system remaining work — 2026-09-10

This execution plan continues directly on `master`. The original scope and
[24 acceptance scenarios](../audits/font-acceptance-matrix-2026-09-09.md) remain
binding. Existing partial implementations are not treated as certification.

## Current audit

The fresh source review started at `8cd73fc72`. Concurrent clipboard, inspector,
CAF and website work is present in the index and working tree. Font commits must
name their paths explicitly and preserve other staged entries. Validation of
this dirty tree is observation evidence, not a frozen-SHA release certificate.

Confirmed additional defects:

- The font combobox consumed Escape even when closed, advertised an unmounted
  active descendant, intercepted native Home/End editing, and reset selection
  through a delayed blur callback. Its first opening searched the current family.
- Inline placement arrays restarted the floating layer's measurement on parent
  renders. The child menu was absolutely positioned inside the toolbar instead
  of receiving its own viewport collision handling.
- Toolbar and inspector weights are invented numeric lists. Bold and italic
  can request unavailable faces. Typography writes bypass the active rich range.
- Native storage is family-addressed; browser legacy migration has no durable
  journal. Exact-face removal and restart-after-uninstall remain unproven.
- Current architecture text overstates identity, variable-axis coupling,
  migration safety, cache completeness and preview restoration.
- The earlier acceptance matrix replaced the original scenarios with narrower
  checks. It is now restored to the supplied scenario numbering.

## Execution order and completion gates

| Slice | Concrete work | Required evidence |
| --- | --- | --- |
| Toolbar and picker | Stable independent menu portal; nested Escape; draft numeric commit; compact controls plus More; shared range/caret commands; effective mixed values and real face controls | Focused component tests, actual pointer/keyboard E2E, inspected Light/Dark/High Contrast and narrow captures, one-step undo and substring assertions |
| Parser and identity | Complete bounds/checksum and real licensed corpus; canonical artifact/member key; exact aliases; embedding bits separated from provenance | Real bytes and malformed fixtures, schema compatibility, full gate for foundational API |
| Storage and discovery | Hash records, artifacts/faces, durable journal/quarantine/tombstones, native opaque handles, exact removal, deliberate browser permissions and native Refresh | Interrupted/repeated migration, cancellation, offline retry, restart and two-document isolation; Linux embedded WDIO |
| Rendering | Canonical HarfBuzz shaping/paths, UTF-8/UTF-16 clusters, exact instance metrics, revision acknowledgements, synchronous worker admission and cache keys | Glyph/bounds/caret oracle, main/worker pixel hashes around forced redraw, mandatory scripts and color-path reporting |
| Manager and document fonts | One face model, instances, compare/specimens/details/tags, usage index, scoped Select by Font, replacement/restore/embed | Original scenarios 8, 12–15, 21, including 1k/10k p95 budgets and virtualized accessibility |
| Portability and export | Format/clipboard/style/story closures, preflight, verified package assets, per-run outlines, explicit alternatives | Save/reopen/import/export corpus and portable collaboration payload tests; full final gate |
| Identification | Transformed crop, bounded local extraction, classifier/comparison, optional local OCR/manual text, explicit target/create/bookmark, cancellation | Real image interaction E2E and inspected crop/candidate/apply workflow |
| Documentation and marketing | Correct architecture/help/privacy/migration claims; typography pages, FAQ and summaries; targeted product captures and manifest | Docs/emoji/token/architecture audits; both website base paths and inspected desktop/dark/narrow pages |

## Frontend delivery gate — September 12 continuation

Every backend slice must include its corresponding editor controls and visible
states before that slice is called complete. A service or passing unit test
alone does not close the user workflow. Keep the inspector, floating text
toolbar, contextual properties bar, docked browser and modal manager on the
same typography commands and face model. Concurrent work on the contextual
properties bar currently displays family and size as read-only text; it does
not satisfy the editable typography control contract.

| Backend change | Required frontend behavior and validation |
| --- | --- |
| Exact identity and face capabilities | Readable family/face fields, real supported choices, retained unavailable requests and explicit fallback details; inspect same-name/revision cases |
| Installation, cancellation and storage | Progress, Cancel, retryable errors, exact removal and restored state after restart; opening/searching/hovering must not initiate downloads |
| Local discovery | Deliberate browser permission action, denied/unsupported states, file and collection-member import, native Refresh |
| Embedding policy | Show the base permission and separate no-subsetting/bitmap-only restrictions, retain unknown license provenance, and explain why an export option is unavailable |
| Typography commands and shaping | Range/caret targeting, effective mixed values, preserved style links, one-step undo, synchronized weight/axes, temporary preview and Escape restoration |
| Usage index and export preflight | Document Fonts, scoped Select by Font, located affected text, replacement/restore and verified embedding alternatives |
| Image matching | Visible crop and candidates, editable recognized text, explicit existing/create-text target, cancellation and useful confidence limitations |

Controls must use the current shared size, spacing, focus and theme tokens.
Check layout against neighboring app controls, not an earlier screenshot in
isolation. Inspect keyboard, Light/Dark/High Contrast, narrow width, real zoom
and DPR states. Update the relevant help, marketing copy and product captures
only after the corresponding interaction has recorded evidence. The September
11 toolbar evidence covers shared sizing, contrast and formatting history;
it does not close the remaining face, range or native-platform requirements.

## Standards informing implementation

The combobox keeps browser text-editing keys and consumes Escape only for its
visible popup. DOM focus stays in its input while its active descendant names
a mounted option. This follows the
[WAI-ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

Local font enumeration requires a deliberate permission workflow and actionable
denial/unsupported states, following the
[Local Font Access specification](https://wicg.github.io/local-font-access/).

Embedding has a base permission plus independent no-subsetting and bitmap-only
bits. These technical flags do not establish all rights under the source
license. The implementation must retain unknown provenance rather than promise
legal permission. See the
[OpenType OS/2 fsType definition](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype).

## Validation policy

Run the planner before affected validation. Shared staged work is not silently
unstaged to narrow a check: use a separate temporary index for task-owned
validation scope, with explicit paths and recorded commands. Browser captures
must be inspected before accepting snapshots. Foundational APIs and schema
migrations require `pnpm verify:full` with an explicit reason at the integration
checkpoint. Collect broad failures once with triage, then repair using targeted
checks.

Windows WebView2 and macOS WKWebView remain platform-owned runs. Their pending
status prevents claiming cross-platform certification; it does not defer Linux
native or browser work that can be executed here.
