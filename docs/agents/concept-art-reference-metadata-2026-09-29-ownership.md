# Concept-art reference metadata — ownership

**Task:** add an optional, compatibility-safe reference role to ordinary image shapes
**Owner:** illustration/concept-art integration
**Branch:** `master` (user-requested)
**Milestone:** scene metadata foundation only; export, sampling, UI controls, and the real reference workflow remain follow-up work.

## Owned paths

| Path | Scope |
|---|---|
| `packages/scene/src/types.ts` | Define optional per-image reference metadata with sampling/export defaults that remain false unless explicitly opted in. |
| `packages/scene/src/documentCodec.ts` | Sanitize metadata on image shapes, retain portable source labels, and leave older documents unchanged. |
| `packages/scene/src/documentCodec.test.ts` | Verify old-document compatibility, round-trip behavior, malformed metadata handling, and absolute-path removal. |
| `docs/architecture/file-ingestion-system.md` | Record the reference metadata contract and privacy boundary. |
| `docs/audits/illustration-concept-art-capability-matrix-2026-09-28.md` | Mark the metadata foundation separately from the still-open import, sampling, export, and presentation workflow. |

## Boundaries

Keep references as ordinary image-filled shape nodes. The optional field must
not change the document format version or alter nodes that do not carry
reference metadata. Store a safe source display name, never an absolute path.
This milestone does not claim that sampling or export honors the two inclusion
flags; those flags are only a persisted contract until the editor integration
and its end-to-end test are complete.

Do not edit the canvas renderer, exporter, artwork sampler, Inspector, or
website in this metadata milestone. Those paths need a separate ownership
check because the shared checkout has active renderer, sampling, and website
work. The final reference workflow must prove visible canvas display,
independent layer visibility, explicit sampling inclusion, export exclusion
by default, opt-in export inclusion, undo/redo, and save/reopen.

## Validation

This is a persisted scene-model change. Run `pnpm verify:plan` before editing,
then the affected checks and the full gate with the stated reason
`optional persisted reference metadata changes the scene/document codec
contract; verify compatibility and serialization across the workspace`.
Keep the existing document format version. Record full-gate blockers that
belong to concurrent work without broadening this slice to repair them.
