# ADR-0233: Clipboard and import boundary

Date: 2026-09-09

## Context

Clipboard, file import, canvas drop, and Figma interoperability share parsing
and placement code, but they do not share the same ownership or trust boundary.
A browser `ClipboardEvent` expires at the end of dispatch. A file picker or
drop can outlive the document and selection that initiated it. Private
clipboard envelopes from other applications are not stable interchange
formats. Treating these paths as one untyped operation caused stale reads,
unrecoverable Cut, duplicate representations, and claims that exceeded the
evidence.

## Decision

1. **Acquire synchronously, commit deliberately.** Clipboard events are
   snapshotted during dispatch under a typed `TransferRequest`. Async reads
   may provide alternatives, but the initiating document, session, revision,
   selection revision, and canvas geometry are captured and checked before an
   import or drop commits. Fallback timers and event snapshots are keyed by the
   operation and gesture identity.
2. **Use one versioned Varve fragment envelope.** It carries ordered roots,
   world anchors, node closure, and only the resource classes the transport can
   validate and remap. The serialized bytes are parsed against the reader's
   limits before an editable write is published. Older version-1 and legacy
   payloads remain readable.
3. **Resolve one logical item from alternatives.** A validated Varve item wins,
   followed by bounded SVG, one raster representation, and plain text. An SVG
   string and equivalent SVG file do not become two pasted objects. Unsupported
   or malformed alternatives do not suppress a valid one.
4. **Keep browser-owned editing native.** Inputs, contenteditable regions,
   dialogs, embedded editors, and IME composition retain native Copy/Cut/Paste.
   The canvas prevents the default only after it has claimed the operation.
5. **Fail closed for proprietary clipboard formats.** Ordinary Figma Copy is
   unsupported until an owned Firefox fixture proves a bounded, versioned
   envelope. Figma Copy as SVG, official REST/plugin JSON, and local `.fig`
   file import remain separate, documented routes with representation-specific
   fidelity reports.
6. **Report the result that landed.** Import Results carries partial losses,
   missing resources, and per-item failures. Cut does not delete when the
   editable transfer is unavailable or the source context changed.

## Consequences

The editor currently shares validation and import reporting, while Paste,
Import, and Drop still retain route-specific preparation and commit code; a
shared `PreparedFragment` transaction is the next application milestone.
Native Wayland and packaged Tauri behavior
require explicit desktop validation; browser unit tests do not stand in for
that evidence. Unsupported component/style/variable/motion closure is
reported rather than reconstructed from destination state. Marketing and help
pages must use the capability matrix and may not claim full SVG, ordinary Figma
Copy, or preview behavior without a passing fixture.

## Evidence

- `docs/audits/clipboard-reliability-audit-2026-09-06.md`
- `docs/architecture/clipboard-system.md`
- `docs/architecture/import-system.md`
- `docs/architecture/figma-import-system.md`
- `packages/editor/src/clipboard.test.ts`
- `packages/editor/src/context.import.test.tsx`
- `packages/import/src/svg.test.ts`
