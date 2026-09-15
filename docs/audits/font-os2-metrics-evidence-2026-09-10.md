# OS/2 metrics correction and fixture evidence — 2026-09-10

The real-font check disproved the previous audit's proposed offset change.
`sxHeight` and `sCapHeight` are at 86/88, not 84/86: the two code-page ranges
occupy bytes 78–85. The existing offset choice was correct. Both heights are
signed FWORD values and exist from OS/2 version 2 onward. Version-0 tables may
be shortened to 68 bytes and require a length check before reading typographic
metrics. Source: [OpenType OS/2 table formats](https://learn.microsoft.com/en-us/typography/opentype/spec/os2).

## Repair

- Bound reads to the OS/2 table, including a valid 78-byte table at end of file.
- Use hhea metrics when a shortened or absent OS/2 has none; retain valid zeros.
- Decode signed heights only when the version and full version-2 table span permit them.
- Reject tables shorter than the legacy 68-byte prefix from metadata extraction.
- Require checked-in real fixtures rather than silently passing when unavailable.
- Correct synthetic version/length, checksum word order and SFNT rangeShift.
- Preserve original WOFF2 format, byte size and SHA-256 when using the
  collection-capable parser entry point, matching the single-face entry point.
- Bound name records and strings to the declared name-table span; decode
  Unicode-platform names as UTF-16BE and ignore incomplete code units.

This is a metrics repair. Base embedding permission, no-subsetting and bitmap-only
must still be separated, and complete parser validation before registration is
still pending. No renderer dispatch, public type, document schema or font
identity format changed in this slice. The collection entry point's WOFF2
identity calculation was corrected as described below. The independent oracle also confirms that
opentype.js exposes OS/2 metadata as `font.tables.os2`; the outlining code's
uppercase `OS2` lookup remains a separate export-policy defect to repair.

## Licensed fixture provenance

These are the actual Fontsource package bytes already bundled by the desktop
app, copied without modification into `packages/engine/src/font/__fixtures__/`. No renamed or relabelled stand-in
font is used. All three packages are version 5.3.0; their original OFL-1.1 license files
and copyright notices are copied alongside the payloads. Tests now fail if these
required repository fixtures or their decompressor are absent. This removes
the engine tests' dependency on the desktop app's installed font packages. The independent oracle was
opentype.js parsing the decompressed payload; expected values are stored as
constants in the parser regression test.

| Package / artifact | SHA-256 of original WOFF2 | x-height / cap-height (font units) |
| --- | --- | --- |
| `@fontsource-variable/geist`, `geist-latin-wght-normal.woff2` | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` | 530 / 710 |
| `@fontsource-variable/ibm-plex-sans`, `ibm-plex-sans-latin-wght-normal.woff2` | `e2291e842cf5af167122a22881a740c7f2dda7716f1e8cd76680264f4a859470` | 516 / 698 |
| `@fontsource-variable/fraunces`, `fraunces-latin-opsz-normal.woff2` | `7234ed860a9cc83045413c4faee63c960a8f2d1917adcf728119307d56e0d783` | 964 / 1400 |

All three artifacts use OS/2 version 4, length 96. Their units per em are
1000, 1000 and 2000 respectively. Fraunces also supplies the non-weight `opsz`
axis already covered by the required real-font test. Static, collection,
multilingual and color-font corpus expansion remains in the acceptance plan.

## Validation

Initial base: `1e8f42b7c`; resumed validation at `439441882`, with shared
working-tree changes throughout. Direct parser validation:
49 tests passed across two files. The full engine lane passed 4,433 tests
with five existing skips. Its compiler then caught a missing `fsType: 0` in the
new synthetic test input; that test-only omission was repaired before resuming
the affected type check and downstream lanes. Already-green engine tests are
retained rather than rerun after a fixture-type correction.

```sh
VARVE_TEST_WORKERS=2 pnpm exec vitest run packages/engine/src/font/fontParser.test.ts packages/engine/src/font/fontParser.realfont.test.ts
GIT_INDEX_FILE=/tmp/varve-font-os2.index pnpm verify:plan --staged
GIT_INDEX_FILE=/tmp/varve-font-os2.index VARVE_TEST_WORKERS=2 pnpm verify:affected --staged
node /tmp/varve-font-os2-resume.mjs
```

Visual evidence for the adjacent toolbar/inspector/website work is recorded in
[its integration log](./font-integration-evidence-2026-09-10.md). This parser-only
slice does not substitute those screenshots for shaping or export parity proof.

The temporary validation runner stopped after codegen unit tests; codegen
typechecking and compositor tests/types passed in a resumed run, whose process
and temporary logs later disappeared before editor results were collected.
Unfinished lanes were restarted with durable workspace-local logs:

```sh
node reports/font-parser-validation/resume.mjs > reports/font-parser-validation/downstream.log 2>&1
pnpm audit:tokens > reports/font-parser-validation/tokens.log 2>&1
node scripts/audit-architecture.mjs --ci > reports/font-parser-validation/architecture.log 2>&1
```

Completed earlier lanes are retained as recorded observations, not silently
reclassified as a single successful full run. The fixture-only switch to
checked-in identical bytes and original-artifact SHA assertion passed the final
49 direct tests and `verify:quick`; it changes no production behavior.

## Collection entry-point follow-up

The required real artifacts reproduced a separate mismatch: all three fonts
received decompressed-TTF hashes, sizes and formats through `parseFontCollection`,
while `parseFontData` correctly retained the original WOFF2 artifact. Three
new tests failed before repair. The collection path now hashes the original
container once and preserves that identity for each returned member, retaining
member metadata and indices. This does not certify a compressed multi-member
collection; that independent fixture remains needed.
The final direct run passed all 52 parser tests, and the engine compiler passed.
Stored entries produced by the former decompressed-byte identity still require
the planned artifact rehash migration; this repair does not invent an exact
identity for legacy family-only records.

```sh
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/engine/src/font/fontParser.realfont.test.ts --testNamePattern 'original artifact identity'
node reports/font-parser-validation/isolated-git.mjs prepare reports/font-parser-validation/paths.txt
GIT_INDEX_FILE="$(cat reports/font-parser-validation/validation-index-path.txt)" pnpm verify:quick --staged
pnpm --filter @varve/engine typecheck
```

## Affected dependency observations

The resumed editor lane completed: 666 test files passed, four failed and one
was skipped; 6,635 tests passed, seven failed and one was skipped. The failures
are in the concurrently edited inspector's `PropertiesPanel`, `sectionRegistry`,
`featureOwnership` and `inspectorContext` tests. The editor compiler then
reported a missing `PresetPickerDensity` type in the concurrent UI changes.
The bounded runner completed all remaining lanes; none of these observations
certify a frozen commit. Passing unit counts: home 179, import 343, layout 76,
print 11, prototype 245, scene 2,873, desktop 67, AI 24, CLI 23, history 176
and UI 614. Their compiler checks passed except desktop, which reported an
unused `Tooltip` import in the concurrent `FillSection.tsx` edit. A targeted
editor compiler rerun reached the same unused import after the concurrent
`PresetPickerDensity` import was repaired. Collaboration typechecking passed.
Website typechecking passed; its unit lane had 190 passes and the two existing
token failures in the unchanged canvas, grids and auto-layout pages.

A later emoji audit found two multiplication-sign violations in the concurrent
`PresetTile.tsx` changes. The earlier font-only quick check had passed. Those
unrelated edits were preserved; the whole-tree gate is not reported as green.
The normal commit hook stopped at those same two violations. The subsequent
commit preparation materializes only the exact staged tree in an isolated
source directory and runs the unchanged hooks there, with `master` still the
commit target. It does not modify, exclude from the shared tree, or approve
the concurrent UI edits. Installed dependencies are linked from the workspace.

## Agent Validation Report

```text
Changed scope: engine font parser and tests; three licensed fixture artifacts and provenance; font architecture, dated audit, acceptance matrix and evidence.
Validation plan: touched-file checks, three direct parser specs after the WOFF follow-up, engine tests/types and the selected reverse dependency closure; docs/emoji audits. No full-suite escalation for this private parser repair.
Commands actually run: the exact planner, affected, resumed lane and targeted repair commands recorded above; pnpm audit:tokens; node scripts/audit-architecture.mjs --ci.
Passed: final 81 parser tests in the exact source snapshot; 436 font/outlining tests; engine typecheck; earlier full engine 4,433 tests; codegen/compositor checks; snapshot quick gate, docs, contrast-token and architecture audits at the recorded tree states.
Skipped as unrelated: Rust workspace, website E2E and full visual suite (no native, website or global rendering changes in this slice); renderer dispatch benchmarks (dispatch unchanged).
Escalations: interrupted runner recovery; scoped staging incident recovered without changing working files; concurrent inspector/UI failures recorded. Earlier schema/foundational font integration still needs its full final gate.
Full suite run: no
If yes, reason: not applicable
```

The broad editor lane found an absent `open-effect-studio` launcher in the
concurrently edited inspector. Its exact isolated rerun failed at the same
assertion (one selected test, 25 deliberately excluded by the name filter),
independent of font parsing:

```sh
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/editor/src/components/Inspector/PropertiesPanel.test.tsx --testNamePattern 'hosts Object Filter'
```

The earlier touched-file format/lint, docs and emoji audits passed before the
concurrent UI emoji violations appeared. The token audit
passed all 153 pairs across three themes. The architecture audit passed with
existing hub-budget warnings. No global render dispatch or UI styling changed
in this parser slice, so the reviewed toolbar/inspector/website captures remain
in the linked integration log; they do not establish native shaping parity.

## Staging recovery

A validation preparation command accidentally addressed the shared index.
It changed no working files or commits. The previous 85 unrelated staged paths
were recovered from saved Git trees `28cb289227872c98406d947f1c640d11a10889c9`
and `963e174b21c3ef3010e1cc8b025a48a2f996021f`, which agree on every unrelated
staged blob. The recovered added/deleted/modified path set matches the captured
pre-command status; fully staged paths match their working files. Recovery
used an atomic index replacement after checking for concurrent index/HEAD
changes. Subsequent preparation and commits use an explicit isolated index,
shared-index backups and before/after comparisons of unrelated staged blobs.

## Name-record follow-up

Six regressions failed before repair: Unicode-platform names were treated as
UTF-8, short declared tables read bytes outside their span, and odd-length
UTF-16 strings silently lost their last code unit. Reads now use a table-bound
view, validate the complete record region and string-storage offset, and
ignore strings that leave that span or end in a partial code unit. The synthetic
Windows record encoder now uses encoding ID 1 for UTF-16 BMP, rather than
incorrectly labelling it as PRC encoding ID 3. Basis:
[OpenType name records and encodings](https://learn.microsoft.com/en-us/typography/opentype/spec/name).

```sh
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/engine/src/font/fontParser.test.ts --testNamePattern 'Unicode-platform|byte name table|incomplete UTF-16'
```

Legacy code-page decoding, format-1 language-tag interpretation and whole-font
registration validation remain separate gaps. This repair does not claim
complete name-table support.

The final font-domain run passed 384 tests in 22 files, including all 58 parser
tests. The engine typecheck and touched-file quick gate passed after these
repairs. Earlier full-engine results are retained; the newly reproduced
defects were repaired using this focused domain rerun during the ongoing
affected-dependency check.

```sh
VARVE_TEST_WORKERS=2 pnpm exec vitest run packages/engine/src/font
pnpm --filter @varve/engine typecheck
```

The subsequent [WOFF repair](./font-woff-evidence-2026-09-10.md) adds decoding,
container validation and reconstruction coverage to this parser milestone.

## Cmap and layout-table bounds follow-up — 2026-09-13

The parser audit found that coverage and GSUB/GPOS feature walks used the whole
file as their read boundary. A malformed subtable could therefore consume
bytes belonging to the next table and advertise coverage or features that the
font did not declare. The repaired walks stay inside the directory's declared
span, validate each format's length and record count, map glyph-zero gaps, and
support the common cmap formats 0, 4, 6, 10, 12, and 13. Validated ranges are
merged and projected to OpenType script tags so multilingual catalog filters
can use actual coverage. The targeted parser suite now passes **85/85** tests,
including truncated cmap/GSUB spans and Latin/Cyrillic/Arabic script coverage.

This remains bounded metadata evidence. It does not certify shaping, glyph
fallback, or the complete Unicode ScriptExtensions data set; legacy Mac name
decoding and format-1 language tags remain open.
