# Font parser corpus evidence — 2026-09-14

This continuation closes the corpus gap identified in the September 9 font
audit. The previous parser tests exercised three Fontsource WOFF2 variable
faces. They did not prove static TrueType names, collection-member offsets,
Arabic/Devanagari/CJK cmap coverage, or colour tables.

## Inputs and provenance

All artifacts are checked in under
[`packages/engine/src/font/__fixtures__`](../../packages/engine/src/font/__fixtures__/README.md)
with an adjacent OFL-1.1 license and a SHA-256 record in `provenance.json`.
The TTC is reproducible from the two unmodified Liberation faces; its table
directory offsets are rebased to the collection container, which is the form a
real TTC reader must consume.

| Artifact | Boundary exercised | SHA-256 |
| --- | --- | --- |
| Liberation Sans Regular TTF | static name table, glyph count, cmap | `baccc64becc3eb7d104b7c84d99f5314a0a1f896e2b3ea6c2f22fc08d2003bee` |
| Liberation Sans/Serif TTC | collection header, member offsets, member identity | `0ea773b2354098ccac1972147993c4d52c6b3cd1338e8bd56ebd0f5cbcd3eefd` |
| Noto Sans Arabic Regular TTF | Arabic script and U+0627 coverage | `bdff3e5659d67e67def05b33f749683b9376ae819d65d3dd62ac4640b3aaef48` |
| Noto Sans Devanagari Regular TTF | Devanagari script and U+0915 coverage | `306b53ecfb182a504dd8a7446093c316387d2fd8dc350d0792ed1753fe0996cd` |
| Noto Sans JP Japanese WOFF2 | WOFF2 reconstruction and U+65E5 coverage | `4a7b928d4d75e7fc0bace614030664a7ea7eb7d2f754fd2b2da9c3c0ed350570` |
| Noto Znamenny Musical Notation TTF | COLR/CPAL colour metadata | `b6ed2a11d2a653e14137a35e4c6fdaf5093434ac12964791ee195270828e7508` |

The Japanese source artifact's embedded name table uses `Noto Sans JP Thin`
for the 400-weight subset. The parser preserves that source string; the test
only asserts its `Noto Sans JP` family prefix and never rewrites it.

## Assertions and commands

The focused corpus test is
`packages/engine/src/font/fontParser.corpus.test.ts`. It asserts:

- original-byte SHA-256 identity and `ttf`/`ttc`/`woff2` formats;
- two distinct TTC members with collection indices 0 and 1 and one artifact
  hash;
- Arabic, Devanagari, and Japanese cmap coverage derived from validated
  subtables;
- COLR/CPAL detection and a non-zero palette count.

Commands run at parent SHA `8e0aed4b0`:

```text
pnpm exec biome check packages/engine/src/font/fontParser.corpus.test.ts
pnpm exec vitest run packages/engine/src/font/fontParser.corpus.test.ts packages/engine/src/font/fontParser.realfont.test.ts packages/engine/src/font/fontParser.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
pnpm audit:docs
pnpm verify:plan
pnpm verify:affected
VARVE_FULL_GATE_REASON='licensed real-font corpus and parser boundary milestone; verify planner escalated because the shared workspace contains foundational and validation-infrastructure changes' pnpm verify:full
```

The focused parser command passed: 3 files, 69 tests. `audit:docs` passed
(877 documents, 472 links, 174 ADRs). The affected planner selected the full
gate because the shared worktree contains concurrent foundational changes.
The full gate reached the architecture and typecheck stages but remained red
on unrelated existing website lint, the concurrent
`contentAwareFill/index.ts → quickCleanup.ts → generativeEdit/types.ts` cycle,
and `quickCleanup.test.ts`/`lut*.test.ts` type errors. No parser or fixture
failure was reported.

## Remaining proof

This corpus proves parsing and metadata boundaries. It does not certify native
font discovery, main/worker glyph parity, colour rendering, or multilingual
caret/BiDi layout. Those remain explicit rows in the acceptance matrix and
need real-byte render/oracle and platform evidence.
