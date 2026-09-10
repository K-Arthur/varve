# WOFF parser repair evidence — 2026-09-10

The fresh audit found a second production path that the synthetic font tests
never exercised: WOFF1 used raw deflate for zlib data, silently discarded tables
that failed decompression, and overwrote the SFNT flavor with the table count.
Search fields were also written at incorrect offsets. The original reader
emitted unhandled writer rejections after the read stream failed.

The repair uses the zlib stream format, requires exact output lengths, and
rejects invalid containers instead of reporting partial metadata. Reconstruction
uses the correct SFNT header fields and checksums. Source:
[WOFF 1.0 table compression and reconstruction](https://www.w3.org/TR/WOFF/).

## Corpus and reproduction

Tests repackage the required licensed Geist fixture into WOFF1 in memory,
using Node's zlib encoder. Names, tables and face metadata come from the real
font; they are not relabelled. opentype.js independently verifies the test
container's family and glyph count. Original fixture provenance and license
are recorded in the [parser evidence](./font-os2-metrics-evidence-2026-09-10.md).

The first 19-case run failed completely and reported 254 unhandled
decompression errors. Two valid-container cases initially failed at an
incorrect test oracle lookup (`names.fontFamily` instead of
`getEnglishName('fontFamily')`); those assertions were corrected before
confirming valid metadata. The 17 malformed-container cases failed against
the original parser and passed after repair. The valid compressed and
uncompressed cases now retain glyph counts, axes, features, coverage and
original-container hashes through both parser entry points.

Additional tests require exact decoded length in both directions, reject
nonzero padding and accept bounded metadata/private blocks. Metadata XML and
private payloads are not interpreted by this metadata parser.

## Bounds and remaining limits

- Original and reconstructed SFNT sizes: at most 128 MiB each.
- Directory: at most 4,095 entries, sorted and unique tags.
- Compressed table: retained output cannot exceed its declared size; a
  two-second deadline cancels the stream and propagates one handled error.
- Spans: complete directory, contiguous aligned table/optional blocks, exact
  container length, zero padding, no overlaps or out-of-file reads.
- Integrity: table checksums, including the special `head` calculation;
  reconstructed whole-font checksum adjustment.

The deadline is per table and cannot interrupt synchronous work on the main
thread. A parser worker with an operation-wide deadline remains necessary.
These limits are not a process-memory benchmark; compressed bytes, tables and
the reconstructed buffer can coexist. Full inner-table validation, WOFF2
decompression limits, collection fixtures and native parser parity remain open.
No new visual claim follows from metadata tests.

## Validation

```sh
VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/engine/src/font/fontParser.woff.test.ts
VARVE_TEST_WORKERS=2 pnpm exec vitest run packages/engine/src/font packages/engine/src/textOutlines.test.ts
pnpm --filter @varve/engine typecheck
node reports/font-parser-validation/isolated-git.mjs snapshot-check reports/font-parser-validation/paths.txt
```

The selected dependency closure and shared-tree failures are recorded in the
[parser report](./font-os2-metrics-evidence-2026-09-10.md). Previously green broad
lanes are retained during this focused repair rather than rerunning the entire
editor after each parser change. Exact staged-tree checks passed in 24.2 seconds:
format/lint, docs and emoji audits, and all 81 parser tests (48 synthetic,
10 real-artifact and 23 WOFF). The shared-tree font/outlining run passed 436
tests across 24 files; engine typechecking passed. No full-suite escalation was selected for this private parser
change; the earlier schema integration still requires its final full gate.

The isolated checkout links existing installed dependencies read-only and sets
`pnpm_config_verify_deps_before_run=false` so pnpm cannot replace the shared
dependency directory. Source comes from the exact staged tree; repository
hooks and checks are unchanged. This is not a clean-install dependency proof.

## Agent Validation Report

```text
Changed scope: engine font metadata parser, WOFF reconstruction, real/synthetic tests and licensed fixtures; architecture, audit, acceptance and evidence docs.
Validation plan: touched-file checks, three direct parser specs, engine units/types and reverse-dependent units/types; docs/emoji audits. No full-suite escalation.
Commands actually run: exact commands above; affected/resumed lanes and audits listed in the linked parser evidence; pnpm verify:quick --staged in the exact source snapshot.
Passed: 81 parser tests in the exact staged snapshot; 436 shared-tree font/outlining tests; engine typecheck; snapshot quick gate including docs/emoji. Earlier green broad lanes retained as recorded.
Skipped as unrelated: native Rust, website E2E, global visual suite and render-dispatch benchmarks; no changes to those surfaces.
Escalations: concurrent inspector/UI and existing website token failures classified in the linked report; unchanged commit hooks run against the proposed source tree to preserve concurrent work.
Full suite run: no
If yes, reason: not applicable
```
