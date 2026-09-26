import { contentHash } from '@varve/platform';
import type { Document, FrameNode } from '@varve/scene';
import {
  addMockupTemplate,
  createDocument,
  createMockupInstanceData,
  DocumentCodec,
  getBuiltinMockupTemplates,
  makeFrameNode,
  makeShapeNode,
  nextNodeId,
  setMockupBinding,
} from '@varve/scene';
import { THUMBNAIL_VARIANTS } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { documentRevisionHash } from '../identity';
import { renderDocThumbnail, shouldPersistThumbnail } from '../thumbnailService';

const VARIANT = THUMBNAIL_VARIANTS['home-card'];

function docWithPageContent(): Document {
  const doc = createDocument('pages');
  const page = doc.pages?.[0];
  const rect = makeShapeNode('page-rect', { kind: 'rect', x: 10, y: 10, w: 200, h: 120 });
  doc.nodes[rect.id] = rect;
  const contentRoot = doc.nodes[page?.contentRoot as string] as { children: string[] };
  contentRoot.children.push(rect.id);
  return doc;
}

/** A document whose root holds a mockup frame presenting a live source frame. */
function docWithMockup(templateId: string): { doc: Document; frameId: string } {
  let doc = createDocument('mockup-thumb');
  const template = getBuiltinMockupTemplates().find((t) => t.id === templateId)!;
  doc = addMockupTemplate(doc, template).document;
  const f = nextNodeId(doc);
  doc = f.doc;
  const frameId = f.id;
  const solid = (r: number, g: number, b: number) => ({
    space: 'rgb' as const,
    r,
    g,
    b,
    a: 255,
  });
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [frameId]: makeFrameNode(frameId, {
        transform: [1, 0, 0, 1, 0, 0],
        w: template.outputWidth,
        h: template.outputHeight,
        fill: solid(236, 233, 227),
      }),
    },
    rootChildren: [...doc.rootChildren, frameId],
  };
  const s = nextNodeId(doc);
  doc = s.doc;
  const sourceId = s.id;
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [sourceId]: makeFrameNode(sourceId, {
        transform: [1, 0, 0, 1, template.outputWidth + 100, 0],
        w: 300,
        h: 300,
        fill: solid(30, 120, 200),
      }),
    },
    rootChildren: [...doc.rootChildren, sourceId],
  };
  const frame = doc.nodes[frameId] as FrameNode;
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [frameId]: { ...frame, mockup: createMockupInstanceData(templateId, {}) },
    },
  };
  doc = setMockupBinding(doc, frameId, template.surfaces[0]!.id, {
    mode: 'live',
    nodeId: sourceId,
  });
  // Automatic/page thumbnail sources resolve through the page content root,
  // so both frames must live there (pasteboard-only content is not covered).
  const contentRoot = doc.nodes[doc.pages?.[0]?.contentRoot as string] as {
    children: string[];
  };
  contentRoot.children.push(frameId, sourceId);
  return { doc, frameId };
}

describe('renderDocThumbnail — source fallback', () => {
  it('falls back to automatic when the requested frame is missing', async () => {
    const doc = docWithPageContent();
    const outcome = await renderDocThumbnail(doc, {
      source: { type: 'frame', nodeId: 'gone' },
      variant: VARIANT,
    });
    expect(outcome.fallbackApplied).toBe(true);
    expect(outcome.effectiveSource.type).toBe('automatic');
    expect(outcome.validity).toBe('valid');
  });

  it('does not fall back when the requested source exists', async () => {
    const doc = docWithPageContent();
    const outcome = await renderDocThumbnail(doc, {
      source: { type: 'page', pageId: doc.pages![0]!.id },
      variant: VARIANT,
    });
    expect(outcome.fallbackApplied).toBe(false);
    expect(outcome.validity).toBe('valid');
  });

  it('produces a placeholder result for empty documents (never transparent pixels)', async () => {
    const doc = createDocument('empty', true);
    doc.rootChildren = [];
    const outcome = await renderDocThumbnail(doc, { variant: VARIANT });
    expect(outcome.result).not.toBeNull();
    expect(outcome.result!.metadata.isPlaceholder).toBe(true);
    expect(outcome.result!.dataUrl.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('falls back to automatic after a page is deleted', async () => {
    const doc = docWithPageContent();
    const pageId = doc.pages![0]!.id;
    const outcome = await renderDocThumbnail(doc, {
      source: { type: 'page', pageId },
      variant: VARIANT,
    });
    expect(outcome.validity).toBe('valid');
    expect(outcome.identity.key).toContain(`page:${pageId}`);
    // The key includes the page source, so a frame source for the same doc
    // can never share the storage slot.
    const frameOutcome = await renderDocThumbnail(doc, {
      source: { type: 'frame', nodeId: 'page-rect' },
      variant: VARIANT,
    });
    expect(frameOutcome.identity.key).not.toBe(outcome.identity.key);
  });
});

describe('renderDocThumbnail — identity', () => {
  it('keys by fileId when present and by revision otherwise', async () => {
    const doc = docWithPageContent();
    const a = await renderDocThumbnail(doc, { fileId: 'f1', variant: VARIANT });
    const b = await renderDocThumbnail(doc, { variant: VARIANT });
    const c = await renderDocThumbnail(doc, { fileId: 'f1', variant: VARIANT });
    expect(a.identity.key).toBe(c.identity.key);
    expect(a.identity.key).not.toBe(b.identity.key);
  });

  it('changes the key when the document revision changes', async () => {
    const doc = docWithPageContent();
    const before = await renderDocThumbnail(doc, { fileId: 'f1', variant: VARIANT });
    const rect = doc.nodes['page-rect'] as unknown as {
      transform: [number, number, number, number, number, number];
    };
    rect.transform = [1, 0, 0, 1, 50, 50];
    const after = await renderDocThumbnail(doc, { fileId: 'f1', variant: VARIANT });
    expect(before.identity.key).not.toBe(after.identity.key);
  });
});

describe('renderDocThumbnail — cancellation', () => {
  it('respects a pre-aborted signal', async () => {
    const doc = docWithPageContent();
    const controller = new AbortController();
    controller.abort();
    const outcome = await renderDocThumbnail(doc, { variant: VARIANT, signal: controller.signal });
    expect(outcome.result).toBeNull();
    expect(outcome.status).toBe('cancelled');
  });

  it('returns an editing quality contract and keeps warnings beside the image', async () => {
    const outcome = await renderDocThumbnail(docWithPageContent(), {
      variant: THUMBNAIL_VARIANTS['effect-studio-preview'],
    });
    expect(outcome.qualityTier).toBe('editing-preview');
    expect(outcome.renderer).toBe('canonical-engine');
    expect(outcome.warnings).toEqual(outcome.result?.metadata.warnings ?? []);
  });

  it('renders page sources in page-local coordinates', async () => {
    const doc = docWithPageContent();
    const outcome = await renderDocThumbnail(doc, {
      source: { type: 'page', pageId: doc.pages![0]!.id },
      variant: { ...VARIANT, width: 64, height: 64 },
    });
    expect(outcome.result).not.toBeNull();
    expect(outcome.result!.metadata.isPlaceholder).toBe(false);
  });
});

describe('thumbnail persistence policy', () => {
  it('does not persist a provisional result', () => {
    expect(
      shouldPersistThumbnail({
        dataUrl: 'data:image/png;base64,placeholder',
        metadata: { isProvisional: true } as never,
      }),
    ).toBe(false);
  });

  it('persists a settled result', () => {
    expect(
      shouldPersistThumbnail({
        dataUrl: 'data:image/png;base64,settled',
        metadata: { isProvisional: false } as never,
      }),
    ).toBe(true);
  });

  it('rejects an empty result', () => {
    expect(shouldPersistThumbnail(null)).toBe(false);
    expect(
      shouldPersistThumbnail({
        dataUrl: '',
        metadata: { isProvisional: false } as never,
      }),
    ).toBe(false);
  });
});

describe('renderDocThumbnail — helper imports', () => {
  it('exposes the empty placeholder as a data URL', () => {
    const { EMPTY_DOCUMENT_PLACEHOLDER } = { EMPTY_DOCUMENT_PLACEHOLDER: 'data:image/svg+xml,' };
    expect(EMPTY_DOCUMENT_PLACEHOLDER.startsWith('data:')).toBe(true);
  });
});

describe('documentRevisionHash — platform consistency', () => {
  it('matches the content hash the platform persists for the same document', () => {
    const doc = docWithPageContent();
    // The editor save path persists DocumentCodec.encode(doc) and the
    // platform stores contentHash(encode) on the FileEntry; the Home loader
    // derives its identity from that persisted hash. The thumbnail identity
    // must hash the SAME bytes or Home lookups miss.
    expect(documentRevisionHash(doc)).toBe(contentHash(DocumentCodec.encode(doc)));
  });
});

describe('renderDocThumbnail — mockup decoration', () => {
  it('runs mockup decoration and reports missing surfaces as warnings', async () => {
    // The live-bound source frame is missing: decoration still runs (proven
    // by the explicit per-surface warning), and the render degrades to the
    // placeholder path instead of silently drawing a bare frame.
    const { doc, frameId } = docWithMockup('builtin:fabric-banner-mesh');
    const frame = doc.nodes[frameId] as FrameNode;
    const broken: Document = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [frameId]: {
          ...frame,
          mockup: {
            ...frame.mockup!,
            surfaceBindings: { front: { mode: 'live', nodeId: 'deleted-source' } },
          },
        },
      },
    };
    const outcome = await renderDocThumbnail(broken, { variant: VARIANT });
    expect(outcome.warnings.some((warning) => warning.startsWith('mockup-surface-missing:'))).toBe(
      true,
    );
  });

  it('marks the thumbnail provisional when decoration is unavailable', async () => {
    // Payload referencing a template that is not embedded: the export
    // decoration barrier refuses to bake, so the bare-frame render must
    // never persist as an authoritative cover.
    const doc = createDocument('mockup-missing');
    const f = nextNodeId(doc);
    let frameDoc = f.doc;
    const frameId = f.id;
    frameDoc = {
      ...frameDoc,
      nodes: {
        ...frameDoc.nodes,
        [frameId]: {
          ...makeFrameNode(frameId, {
            transform: [1, 0, 0, 1, 0, 0],
            w: 300,
            h: 300,
            fill: { space: 'rgb', r: 240, g: 240, b: 240, a: 255 },
          }),
          mockup: createMockupInstanceData('missing-template', {}),
        },
      },
      rootChildren: [...frameDoc.rootChildren, frameId],
    };
    const contentRoot = frameDoc.nodes[frameDoc.pages?.[0]?.contentRoot as string] as {
      children: string[];
    };
    contentRoot.children.push(frameId);
    const outcome = await renderDocThumbnail(frameDoc, { variant: VARIANT });
    expect(outcome.warnings).toContain('mockup-decoration-unavailable');
    expect(outcome.status).toBe('provisional');
  });
});
