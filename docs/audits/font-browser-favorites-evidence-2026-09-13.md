# Font browser favorites evidence — 2026-09-13

The full font browser already persisted `isFavorite` in its semantic catalog and
offered a Favorites source filter, but the results rows had no action to create
that state. This left the filter empty unless another surface mutated the
catalog and made the requested manager workflow incomplete.

Each family row now has an accessible star control. It uses the shared
`IconButton`, exposes `aria-pressed`, stops propagation so marking a family does
not select or apply it, and updates the semantic catalog without touching the
document or undo history. The label changes between **Add a family to
favorites** and **Remove a family from favorites**. The existing Favorites tab
therefore reflects the same durable user state as the row control.

Focused validation:

```text
pnpm exec biome check packages/editor/src/components/FontBrowser/FontBrowser.tsx packages/editor/src/components/FontBrowser/FontBrowser.css packages/editor/src/components/FontBrowser/FontBrowser.test.tsx
TMPDIR=/home/kevina/CodingProjects/varve/.tmp pnpm exec vitest run packages/editor/src/components/FontBrowser/FontBrowser.test.tsx --config vitest.config.ts --pool=threads --maxWorkers=1 --no-file-parallelism --reporter=dot
```

The touched-file check passed and the FontBrowser suite passed **9/9**. The
new regression searches for Gothic A1, toggles the star twice, verifies the
spoken state and pressed state, and confirms that `onSelect` was never called.

This is a manager interaction improvement; the broader 1k/10k virtualization
budget, component-instance usage index, and native platform evidence remain
open in the [font acceptance matrix](font-acceptance-matrix-2026-09-09.md).
