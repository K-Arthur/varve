/**
 * Canonical sample document for the public browser demo (/try).
 *
 * Built from the scene model API at runtime — never hand-authored JSON — so
 * the sample is always at the current schema version and needs no migration
 * path. Deterministic ids make seeding idempotent and tests stable.
 *
 * The document is deliberately modest (a poster frame with a handful of
 * shapes and text) so it renders quickly through the WASM engine on first
 * load, while still showing off vector shapes, text, strokes, and layers.
 */
import { contentHash, type FileEntry, type Platform } from '@varve/platform';
import {
  addNode,
  createDocument,
  type Document,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
  serializeDocument,
} from '@varve/scene';

/** Fixed library id for the demo sample — stable across visits so a seeded
 *  document is reused (and user edits are never clobbered by re-seeding). */
export const DEMO_SAMPLE_FILE_ID = 'varve-demo-sample';

export const DEMO_SAMPLE_DOCUMENT_NAME = 'Varve Demo';

const TEAL = { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } as const;
const PINK = { space: 'rgb', r: 255, g: 110, b: 140, a: 255 } as const;
const GOLD = { space: 'rgb', r: 255, g: 193, b: 84, a: 255 } as const;
const INK = { space: 'rgb', r: 16, g: 21, b: 31, a: 255 } as const;
const PAPER = { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } as const;
const MUTED = { space: 'rgb', r: 96, g: 108, b: 128, a: 255 } as const;
const OUTLINE = { space: 'rgb', r: 210, g: 216, b: 228, a: 255 } as const;
/** Stroke-only shapes still need a fill; makeShapeNode defaults to teal. */
const NO_FILL = { space: 'rgb', r: 0, g: 0, b: 0, a: 0 } as const;

/** Stable doc id for the sample — makes serialization deterministic. */
const SAMPLE_DOC_ID = '00000000-0000-4000-a000-000000000001';

/** Build the canonical demo document. Pure and deterministic. */
export function buildDemoSampleDocument(): Document {
  const base = createDocument(DEMO_SAMPLE_DOCUMENT_NAME, { flat: true });
  // Override the random doc id with a stable value for determinism — the
  // codec stamps this id into the serialized JSON, so different random ids
  // would make each build produce a different byte sequence.
  const doc0 = { ...base, id: SAMPLE_DOC_ID };
  let doc = doc0;

  const insert = <T extends Parameters<typeof addNode>[1]>(node: T) => {
    const { doc: next, id } = nextNodeId(doc);
    doc = addNode(next, { ...node, id });
    return id;
  };

  const frameW = 1200;
  const frameH = 800;

  insert(
    makeFrameNode('', {
      name: 'Poster',
      w: frameW,
      h: frameH,
      children: [],
      fill: PAPER,
      clipContent: true,
    }),
  );

  // Teal circle, top-right.
  insert(
    makeShapeNode(
      '',
      { kind: 'circle', cx: 0, cy: 0, r: 170 },
      {
        name: 'Sun',
        transform: [1, 0, 0, 1, 860, 60],
        fill: TEAL,
      },
    ),
  );

  // Pink rounded card, bottom-left.
  insert(
    makeShapeNode(
      '',
      { kind: 'rect', x: 0, y: 0, w: 300, h: 220 },
      {
        name: 'Card',
        transform: [1, 0, 0, 1, 90, 490],
        fill: PINK,
        cornerRadius: 28,
        cornerSmoothing: 0.6,
      },
    ),
  );

  // Three accent dots.
  for (let i = 0; i < 3; i += 1) {
    const colors = [TEAL, PINK, GOLD];
    insert(
      makeShapeNode(
        '',
        { kind: 'circle', cx: 0, cy: 0, r: 12 },
        {
          name: `Dot ${i + 1}`,
          transform: [1, 0, 0, 1, 90 + i * 44, 390],
          fill: colors[i],
        },
      ),
    );
  }

  // Headline.
  insert(
    makeTextNode('', 'Varve', {
      name: 'Headline',
      transform: [1, 0, 0, 1, 90, 120],
      w: 760,
      h: 190,
      fontSize: 150,
      // The bundled @fontsource-variable/fraunces registers the family as
      // 'Fraunces Variable' — asking for plain 'Fraunces' makes the editor
      // raise its Missing Fonts dialog over the demo on first paint.
      fontFamily: 'Fraunces Variable',
      fontWeight: 600,
      lineHeight: 1,
      fill: INK,
    }),
  );

  // Subtitle.
  insert(
    makeTextNode('', 'Local-first design, in your browser', {
      name: 'Subtitle',
      transform: [1, 0, 0, 1, 94, 330],
      w: 680,
      h: 48,
      fontSize: 30,
      fontFamily: 'IBM Plex Sans Variable',
      fontWeight: 500,
      lineHeight: 1.3,
      fill: INK,
    }),
  );

  // Body copy.
  insert(
    makeTextNode(
      '',
      'This is a real document — select the layers, move them, change the colors. Your edits stay in this browser and nothing is uploaded.',
      {
        name: 'Body',
        transform: [1, 0, 0, 1, 94, 392],
        w: 560,
        h: 76,
        fontSize: 16,
        fontFamily: 'IBM Plex Sans Variable',
        lineHeight: 1.5,
        fill: MUTED,
      },
    ),
  );

  // Thin outline frame on top (stroke only).
  insert(
    makeShapeNode(
      '',
      { kind: 'rect', x: 0, y: 0, w: frameW - 40, h: frameH - 40 },
      {
        name: 'Outline',
        transform: [1, 0, 0, 1, 20, 20],
        // Opaque black here painted over the entire poster — the frame is
        // meant to be its stroke and nothing else.
        fill: NO_FILL,
        strokes: [
          {
            color: OUTLINE,
            weight: 2,
            align: 'inside',
            cap: 'butt',
            join: 'miter',
            dashPattern: [],
            dashOffset: 0,
            miterLimit: 4,
            visible: true,
          },
        ],
      },
    ),
  );

  return doc;
}

/** Serialize the sample document (stable content across calls). */
export function serializeDemoSample(): string {
  return serializeDocument(buildDemoSampleDocument());
}

/** Construct the library entry for the sample document. */
export function makeDemoSampleEntry(now: number = Date.now()): FileEntry {
  const json = serializeDemoSample();
  return {
    id: DEMO_SAMPLE_FILE_ID,
    name: DEMO_SAMPLE_DOCUMENT_NAME,
    kind: 'strata',
    projectId: null,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    size: json.length,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: contentHash(json),
  };
}

export type DemoSeedResult =
  | { ok: true; entry: FileEntry; json: string; seeded: boolean }
  | { ok: false; error: string };

/**
 * Ensure the demo sample exists in the platform store, then return its entry
 * and JSON. Seeding is idempotent: an existing sample (including one the user
 * has edited) is never overwritten — the demo opens the user's version.
 */
export async function seedDemoSample(platform: Platform): Promise<DemoSeedResult> {
  const existing = await platform.readFile(DEMO_SAMPLE_FILE_ID).catch(() => null);
  if (existing) {
    return { ok: true, entry: makeDemoSampleEntry(), json: existing, seeded: false };
  }
  try {
    const entry = makeDemoSampleEntry();
    const json = serializeDemoSample();
    await platform.upsertFile(entry, json);
    return { ok: true, entry, json, seeded: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Font families the sample document renders with, as registered by the
 * bundled @fontsource-variable packages.
 */
const SAMPLE_FONT_SPECS = ['600 150px "Fraunces Variable"', '500 30px "IBM Plex Sans Variable"'];

/**
 * Load the sample's fonts before the document opens.
 *
 * `document.fonts.check()` — which drives the editor's Missing Fonts dialog —
 * reports false for a declared-but-unloaded @font-face. IBM Plex is safe
 * because the interface itself uses it, but Fraunces is an editorial face that
 * appears nowhere in the demo's chrome, so nothing else pulls it in. Without
 * this the demo greets every visitor with a modal offering to replace the
 * sample poster's headline font with Arial.
 *
 * Failures are ignored: a missing font degrades to the fallback stack, which
 * is a far better outcome than refusing to open the document.
 */
export async function preloadSampleFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.allSettled(SAMPLE_FONT_SPECS.map((spec) => document.fonts.load(spec)));
}
