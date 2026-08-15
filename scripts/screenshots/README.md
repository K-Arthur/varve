# Product screenshot pipeline

Marketing and documentation screenshots of the Varve application are
generated — never hand-copied — by driving the real editor into
deterministic states.

## Commands

| Command | What it does |
|---|---|
| `pnpm screenshots:product` | Capture every scene into `docs/screenshots/product/`, sync a copy into `apps/website/public/screenshots/`, and rewrite `apps/website/src/data/screenshot-manifest.json` |
| `pnpm screenshots:og` | Render the 1200x630 social-card image from `scripts/screenshots/og-template.html` into `apps/website/public/og-image.png` |
| `pnpm screenshots:website` | Build the website and validate the manifest (fails on broken/missing references) |
| `pnpm screenshots:update` | Capture + OG + build + strict validation (fails if any scene cannot be captured) |

Targeted capture: `pnpm screenshots:product -- --scenes workspace,vector`
Strict mode: `pnpm screenshots:product -- --strict` (exit non-zero on any skip)

## Source of truth

- **Canonical captures:** `docs/screenshots/product/*.png` — consumed by
  GitHub Markdown and repository docs.
- **Website copies:** `apps/website/public/screenshots/*.png` — synced by
  the capture script; never committed by hand.
- **Manifest:** `apps/website/src/data/screenshot-manifest.json` — the only
  place alt text, captions, themes and validation state live. The website
  renders screenshots from the manifest, so a missing capture degrades to a
  clear placeholder instead of a stale image.

## Demo documents

The captures open **real Varve documents**, authored in
`scripts/screenshots/demo-document.ts` with the same `@varve/scene` factories
the application uses, and loaded through the application's own File > Open
input. Nothing is mocked or staged: the editor renders these documents exactly
as it renders a user's own work.

Encoded copies live in `scripts/screenshots/fixtures/*.varve` so the capture
script (plain Node) can read them without a TypeScript loader. They are
regenerated with:

```bash
UPDATE_DEMO_DOCS=1 pnpm test:website
```

`apps/website/src/test/demoDocuments.test.ts` re-encodes every document and
fails if a fixture is stale, so the committed bytes can never drift from the
generator or the document codec.

Scripting mouse drags was the previous approach; it produced a single flat
rectangle and depended on tool timing. Authoring the document instead gives a
seeded composition that exercises gradients, strokes, Bézier geometry, blend
modes and a real type hierarchy.

## Scenes

| Scene | Theme | Crop | Captures |
|---|---|---|---|
| `workspace` | light | full | Poster document, headline selected, inspector populated |
| `workspace-dark` | dark | full | Same document, dark theme |
| `vector` | light | canvas | Path in node-edit mode — anchors and Bézier handles |
| `typography` | light | canvas | Type specimen: display, character set, subhead, body |
| `typography-panel` | light | inspector | Font family, weight, size, line height, tracking |
| `layers` | light | layers | Named layers with blend-mode and opacity badges |
| `layout` | light | full | Two-page editorial spread |
| `motion` | dark | timeline | Timeline panel with a real position keyframe |

Detail scenes are cropped **at capture time** (`clip`), because the website
shows them at roughly a third of the page width where a scaled-down full
window is an unreadable smear.

Scenes that cannot be produced are recorded as `skipped` with a reason, and
any previous output file is **deleted** — never silently replaced by an older
screenshot. The motion scene authors a real position keyframe through the
application's keyboard shortcut before capture, so the timeline screenshot
does not claim more than the fixture actually demonstrates.

## Determinism

- Fresh browser context per scene (no localStorage/IndexedDB leakage);
- first-run UI (welcome dialog, onboarding checklist, "Did you know?" tips) is
  suppressed by seeding the persisted state a returning user would have —
  the application needs no screenshot mode;
- committed document fixtures rather than scripted drawing;
- framing asserted via Fit-all plus a zoom read-back, so a scene fails rather
  than shipping a mis-framed capture (note: selecting a layer reveals and
  zooms to it, so scenes select *then* fit);
- fixed viewport 1440x900 at DPR 1 with reduced motion;
- waits on fonts/canvas/settle rather than fixed sleeps;
- mouse parked off-canvas before capture (no hover ambiguity);
- no text-edit carets, no playhead animation, no notifications.

## Validation

`node scripts/screenshots/validate.mjs [--strict]` checks:

- every captured manifest entry has a real, non-empty PNG with sane dimensions;
- manifest dimensions match the files;
- skipped entries carry a reason;
- every `/screenshots/` reference in docs/README/website sources resolves to a
  captured entry (no stale paths, no orphan files).

A Vitest mirror runs in `pnpm test:website` (`src/test/screenshots.test.ts`).
