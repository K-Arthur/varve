# Font parser deadline evidence — 2026-09-14

The parser now exposes `FontParseOptions` with an optional `AbortSignal` and a
whole-operation deadline. The default deadline is two seconds. Checks run
before and between collection members, table-directory records, WOFF blocks,
decompression reads, name/fvar/cmap/GSUB/GPOS records, and coverage merging.
The download manager owns a validation controller and aborts it when the user
cancels a validating download.

## Focused evidence

| Check | Command | Result |
| --- | --- | --- |
| Real and synthetic parser corpus, WOFF reconstruction, collections, malformed inputs | `pnpm exec vitest run packages/engine/src/font/fontParser.test.ts packages/engine/src/font/fontDownloadManager.test.ts packages/engine/src/font/fontParser.woff.test.ts packages/engine/src/font/fontParser.corpus.test.ts packages/engine/src/font/fontParser.realfont.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot` | 5 files, 114 tests passed |
| Abort/deadline and cancellation-race assertions | Included in the parser run above | Already-aborted signal and zero-millisecond deadline reject with actionable errors; cancellation during an in-flight validation produces neither completion nor failure |
| Changed parser/download-manager surface | `pnpm exec biome check packages/engine/src/font/fontParser.ts packages/engine/src/font/fontParser.test.ts packages/engine/src/font/fontDownloadManager.ts packages/engine/src/font/fontDownloadManager.test.ts packages/engine/src/font/index.ts` | Passed |

## Limits

The checks are synchronous budget checkpoints inside the current parser
implementation. A dedicated parser worker still needs to be integrated for
hard isolation from main-thread CPU starvation, and each inner OpenType table
format still needs its own structural validation. Native Windows/macOS proof
and a real cancellation-during-heavy-table E2E remain pending.
