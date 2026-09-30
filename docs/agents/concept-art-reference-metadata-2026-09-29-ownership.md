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

## Validation report — metadata foundation

Changed scope: `packages/scene/src/types.ts`,
`packages/scene/src/documentCodec.ts`,
`packages/scene/src/documentCodec.test.ts`,
`docs/architecture/file-ingestion-system.md`, this ownership record, and the
capability matrix.

Validation plan: `pnpm verify:plan --staged` selected touched-file format and
lint, emoji/docs audits, E2E typecheck, the direct codec test, the full scene
test/typecheck pair, dependent package checks, and export E2E. It escalated to
the full gate because a persisted scene/document codec contract can affect
every package.

Commands actually run:

```text
pnpm exec biome check packages/scene/src/types.ts packages/scene/src/documentCodec.ts packages/scene/src/documentCodec.test.ts
pnpm exec vitest run packages/scene/src/documentCodec.test.ts --maxWorkers=1
pnpm --filter @varve/scene typecheck
pnpm audit:docs
GIT_INDEX_FILE=/tmp/varve-reference-metadata-current.index pnpm verify:plan --staged
GIT_INDEX_FILE=/tmp/varve-reference-metadata-current.index pnpm verify:affected --staged
GIT_INDEX_FILE=/tmp/varve-reference-metadata-current.index VARVE_FULL_GATE_REASON="optional persisted reference metadata changes the scene/document codec contract; verify compatibility and serialization across the workspace" pnpm verify:full
```

Passed: touched-file Biome, direct codec tests (32/32), scene typecheck,
`audit:docs` (1128 documents, 735 links, 178 ADRs), and the full-gate emoji
audit. The full gate typechecked the scene package and the earlier dependent
packages successfully.

Skipped or blocked: `verify:affected --staged` stopped as designed and required
the full gate. `verify:full` exited 1 before test lanes: repository-wide
formatting found an unrelated missing final newline in
`native-webgl2-2026-09-28T10-16-25-630Z.json`; the shared health audit found
`packages/editor/src/Shell.tsx` above its line ceiling; the architecture
dead-code scan timed out in `ts-prune` on the large editor package; and the
editor typecheck failed on the existing `CurveEditor.test.tsx` use of an
unsupported `ByRoleOptions.exact` field. E2E typecheck and full test suites did
not run because the package typecheck command stopped at that error. These
failures are outside this metadata slice and were not repaired here.

Escalation: full gate required for the persisted contract change.
Full suite run: no; full-gate escalation was attempted, but the gate stopped
at editor typecheck before test execution.
