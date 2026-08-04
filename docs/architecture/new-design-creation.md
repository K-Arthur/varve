# New Design — creation flow, document model, and native format

Adopted 2026-08-04. Supersedes the "New File" preset-as-document-size model.

## Product model

- **A new Varve document is an untitled infinite-canvas document.** It never
  carries a width, height, page, or color mode of its own.
- **Width/height belong to frames, pages, and print layouts.** Device, social,
  photo, print, and presentation presets define *frame* properties.
- **Three starting points**, mutually exclusive:

  | Start | Result |
  |---|---|
  | Empty document | Flat, page-less document. No frame. |
  | Start with a frame | Flat document + exactly one frame node at the origin with the preset/custom dimensions. |
  | Template | Document decoded from `templateJson` through the versioned migration pipeline. |

- **Templates are separate from frame presets**: they carry actual design
  content, styles, components, and possibly multiple frames.
- **Print and advanced settings are document-level metadata**, collapsed behind
  an "Advanced settings" disclosure and auto-revealed by print presets:
  color mode (RGB/CMYK/grayscale — soft-proofed intent, preview always RGB),
  DPI, and bleed. 16-bit rendering is not exposed because the renderer is
  uint8 end-to-end.
- **Screen documents use defaults**: RGB, 8-bit, no bleed/DPI.

## Canonical creation service

`createNewDocument(request)` in `packages/scene/src/newDocument.ts` is the single
entry point. Request shape:

```ts
{
  documentName?: string;            // display name; defaults to 'Untitled'
  startMode?: 'empty' | 'framePreset' | 'customFrame' | 'template';
  preset?: Preset;                  // framePreset
  customFrame?: { width; height; unit };  // customFrame
  templateJson?: string;            // template — decoded via DocumentCodec
  colorMode?: ColorMode;            // advanced
  bitDepth?: 8 | 16;
  bleed?: PresetBleed;
  dpi?: number;
  colorProfileId?: string;
}
```

It returns `{ ok, result: { document, initialFrameId, warnings? } }` or a typed
error. Creation is atomic: a failed template decode never leaves a half-created
document behind.

Callers (all wired to the service):

- Home screen "New" button and empty states → `NewDesignDialog`
- File → New / Ctrl+N / command palette / QuickActions → `usePersistence.newDocument`
- Template creation (home Templates section and dialog)
- `createDocumentFromPreset` in `presetToDocument.ts` remains for legacy
  print-first flows that genuinely need a fixed-size page document
  (import/export/print paths depend on `physicalWidth`/`physicalHeight`).

Naming helpers live in `@varve/shared/src/untitledName.ts`:

- `nextUntitledName(usedNames)` — collision-free "Untitled N"
- `sanitizeFileName(name)` — strips filesystem-invalid characters, preserves
  Unicode, never appends an extension
- Duplicate names are resolved at save time, not at creation time.

## Dependency map

```
UI action (New button / empty state / Ctrl+N / palette)
  → NewDesignDialog (home) or usePersistence.newDocument (editor)
  → createNewDocument(request)                    [@varve/scene]
  → Document (schema CURRENT_DOCUMENT_VERSION)    [flat, optional frame]
  → serializeDocument → platform.upsertFile       [store + recents + thumbnail]
  → editor opens via handleOpenFile → session with fileId/filePath
  → Save: filePath ? writeDocumentToPath(path) : saveAsImpl → platform.saveDocumentToDisk
```

## Native format: `.varve` with `.strata` compatibility

- `DOCUMENT_EXT = 'varve'`, `LEGACY_DOCUMENT_EXT = 'strata'` (platform `pure.ts`).
- Both extensions map to the same persisted `FileKind` (`'strata'` is kept as
  the storage value — SQLite `files.kind DEFAULT 'strata'` is a compatibility
  identifier and must not be renamed).
- The document schema version (`CURRENT_DOCUMENT_VERSION`) is independent of
  both the extension and the product version. `.strata` files run through the
  same migration pipeline as `.varve`.
- Open/Save filters offer both extensions; the save dialog defaults to `.varve`.
- Legacy files are never destructively rewritten on open; Save As defaults to
  `.varve` and offers `.strata` only when needed.
- File → Save for a document opened from disk writes back to the original path
  (`platform.writeDocumentToPath`; Tauri writes atomically via
  `home_write_text_file`, web falls back to the picker, memory is a no-op).
- Persisted identifiers with rename migrations: version-history localStorage
  keys (`varve-versions` with `strata-versions` read fallback), recovery
  IndexedDB (`varve-recovery` with one-time idempotent copy from
  `strata-recovery`, never deleted).
- Platform metadata: `application/x-varve` + legacy `application/x-strata` MIME
  types registered in `tauri.conf.json`, `linux/dev.varve.desktop.xml`, and the
  AUR PKGBUILD; the home-directory watcher and import accept lists cover both
  extensions.

## Responsive top bar

The menubar is a flex chain — `[home][menus][title][workspace tabs][undo/redo/zoom]` —
so items can never overlap. The title truncates with an ellipsis (`min-width: 0`).
Workspace tabs are data-driven:

- `WORKSPACE_OVERFLOW_ORDER` (display order): Design, Draw, Photo, Print, Motion,
  Codegen & Audit, Logo.
- `WORKSPACE_OVERFLOW_PRIORITY`: Design never overflows; Logo/Codegen overflow
  first.
- `computeWorkspaceLayout` (pure, unit-tested) decides visible vs. overflow
  tabs from measured widths; the active mode is always visible (a lower-priority
  tab is evicted to the "More" menu if needed).
- Below 900px tabs become icon-only; at very narrow widths only the active tab
  stays on screen — every mode remains reachable via the overflow menu,
  keyboard shortcuts, and the command palette.

## Accessibility notes

- The dialog: native `<dialog>` focus trap, focus restored to the trigger on
  close, Enter creates (never while a text input or the preset listbox owns
  Enter), Escape closes, radios carry accessible names including icon-only
  workspace tabs.
- Dark/light/high-contrast all trace to semantic tokens; the modal overlay fix
  (display:flex scoped to `[open]`) also restored correct closed-dialog
  behavior.
