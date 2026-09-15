# Exact-face inheritance evidence — 2026-09-14

This checkpoint closes an identity propagation gap found during the September
14 font audit. A text node can carry an exact artifact/member reference while
its rich runs omit a family and inherit the node face. The same reference must
reach layout, usage indexing, Select by Font, export readiness, and package
dependency collection. A run that names another family must clear the parent
reference unless it supplies its own exact face.

## Implementation

Commit `67afbd871` adds the shared `inheritedFontReference` adapter and uses it
in the canonical rich layout snapshot, the font usage index and resolver,
document-font usage, Select by Font matching, raster/PDF export readiness, and
package font dependency collection. The adapter compares normalized family
names, preserves an explicit run reference, and never carries an artifact hash
across a family boundary.

This keeps the portable key (`sha256:<artifact>:<member>`) attached to the
actual face that shapes and exports the run. It also prevents a same-family
legacy fallback from being mistaken for an exact artifact when a run changes
family without supplying a new reference.

## Evidence

Focused checks passed from the task tree:

```text
pnpm exec biome check packages/engine/src/font/fontFaceInheritance.ts packages/engine/src/font/fontFaceInheritance.test.ts packages/engine/src/font/fontUsageIndex.ts packages/engine/src/font/fontResolver.ts packages/engine/src/font/fontResolver.test.ts packages/editor/src/commands/selectionCommands.ts packages/editor/src/components/SpecPanel/export.ts packages/engine/src/richTextLayout.ts packages/editor/src/packageExport.ts packages/editor/src/components/FontBrowser/documentFontUsage.ts
pnpm exec vitest run packages/engine/src/font/fontFaceInheritance.test.ts packages/engine/src/font/fontResolver.test.ts packages/engine/src/text/paragraphLayout.test.ts packages/engine/src/textLayoutSnapshot.test.ts packages/editor/src/components/FontBrowser/documentFontUsage.test.ts packages/editor/src/packageExport.test.ts packages/editor/src/commands/__tests__/selectionCommands.test.ts packages/editor/src/components/SpecPanel/export.test.ts --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
```

Result: **126 tests passed across 8 files**. Coverage includes inherited and
explicit collection members, family changes, rich layout identity, document
usage, package closure, raster export readiness, and Select by Font matching.

This evidence does not certify native WebKitGTK, Windows WebView2, or macOS
WKWebView exact-face loading. Those platform runs remain open in the acceptance
matrix.
