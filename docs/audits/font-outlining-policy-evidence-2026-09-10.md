# Font outlining metadata correction — 2026-09-10

The outlining adapter read `font.tables.OS2`, but the installed opentype.js
parser exposes `font.tables.os2`. It also masked out the restricted bit and
allowed no-subsetting to replace the base permission. Four regression cases
failed before repair using the required licensed Geist fixture with synthetic
OS/2 flags. The original checked-in font bytes are unchanged; each test variant
recomputes the OS/2 checksum and whole-font checksum adjustment in memory.

The adapter now reads the real table name and retains restricted and preview/print
diagnostics even when no-subsetting is set. Bitmap-only is read independently
for OS/2 versions 2–5. Versions 0–1 ignore later flags; versions 0–2 use the
permitted least-restrictive interpretation of multiple base bits. Modern
conflicting or reserved bits produce an unknown-permissions diagnostic.
Bitmap-only and a restricted base each retain their own diagnostic when
combined, including when no-subsetting is also set.
The technical flags do not establish source-license provenance or legal
permission to outline or redistribute. Basis:
[OpenType OS/2 fsType](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype).

This is an outlining diagnostic repair. The shared parser/catalog/license
policy and package manifest still need separate base/no-subsetting/bitmap-only
fields and verified policy integration. Glyph lookup, shaping, rich-run face
resolution and export enforcement remain open. No rendering dispatch or
document schema changes are included here.

## Evidence

The fixture is recorded in the [parser evidence](./font-os2-metrics-evidence-2026-09-10.md).
Outlining tests now load those checked-in bytes directly, removing the previous
dependency on an installed desktop Fontsource package and shell subprocess.

```sh
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/engine/src/textOutlines.test.ts --testNamePattern 'reads OS/2'
```

Before repair: four failed, four passed; 18 existing tests were excluded by the
name filter. After repair, all 30 outlining tests and the engine typecheck
passed, including new unknown-permission cases for malformed modern flags.

```sh
node reports/font-parser-validation/isolated-git.mjs prepare reports/font-parser-validation/outlines-paths.txt
GIT_INDEX_FILE="$(cat reports/font-parser-validation/validation-index-path.txt)" pnpm verify:quick --staged
VARVE_TEST_WORKERS=2 pnpm exec vitest run packages/engine/src/textOutlines.test.ts
pnpm --filter @varve/engine typecheck
pnpm audit:docs
node reports/font-parser-validation/isolated-git.mjs snapshot-check reports/font-parser-validation/outlines-paths.txt
```

The quick gate passed touched-file formatting/lint, then stopped at two
emoji-audit violations in concurrently edited `PresetTile.tsx`. Direct tests,
engine typechecking and the docs audit were run explicitly afterward and passed.
The ongoing affected dependency run and its unrelated inspector/UI failures
are recorded in the parser evidence log. The policy repair does not introduce
a new schema, public API or render-dispatch change, so the planner did not
select a full-suite escalation or new visual lane.

The parser fixture prerequisite was committed as `8640afa44`. The later exact
staged-tree check uses the unchanged validation commands and hooks against
only the proposed source tree, leaving concurrent UI edits and shared staging
untouched. Existing installed dependencies are linked read-only, as described
in the [WOFF report](./font-woff-evidence-2026-09-10.md).
The exact staged-tree quick gate passed in 13.1 seconds: format/lint, docs and
emoji audits, and all 30 outlining tests. Engine typechecking also passed in
the shared tree after the final diagnostic change.

## Agent Validation Report

```text
Changed scope: engine textOutlines diagnostics and required-fixture tests; text-pipeline guidance and evidence.
Validation plan: touched-file checks, direct outlining spec, engine and reverse-dependent unit/type checks, docs/emoji audits; no new full-suite escalation.
Commands actually run: exact commands above; affected dependency commands retained in the parser evidence log.
Passed: 30 outlining tests in both shared and exact staged trees; engine typecheck; exact staged quick gate including format/lint, docs and emoji audits.
Skipped as unrelated: native Rust, website E2E, global visual snapshots and renderer benchmarks; no native, website, UI layout or render dispatch change.
Escalations: shared-tree inspector/UI and emoji failures are recorded separately; the overall font program remains open.
Full suite run: no
If yes, reason: not applicable
```
