# Font selector focus evidence — 2026-09-13

The compact picker now follows the focus behavior expected of an editable
combobox. The input advertises its portaled listbox, `Alt+ArrowDown` opens the
menu without changing the search, Home and End remain native text-editing
keys, and selecting an option leaves the input focused without reopening the
menu. Escape still dismisses the open picker before it reaches the text-edit
session.

Focused validation:

```text
./node_modules/.bin/biome check packages/editor/src/components/FontBrowser/FontSelector.tsx packages/editor/src/components/FontBrowser/FontSelector.test.tsx
  clean

TMPDIR=/home/kevina/varve-tmp ./node_modules/.bin/vitest run packages/editor/src/components/FontBrowser/FontSelector.test.tsx --config vitest.config.ts --reporter=dot
  1 file, 9 tests passed
```

The existing Chromium selector capture remains the visual evidence for the
open, narrow, light/dark/high-contrast states. A fresh browser rerun was
attempted during the same shared-tree window as the face-policy check but was
blocked by unrelated missing exports before global setup reached the editor;
that limitation is recorded in the face-policy evidence log.
