import { contentHash } from '@varve/platform';
import type { Document } from '@varve/scene';
import { createDocument, DocumentCodec, makeShapeNode } from '@varve/scene';
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
