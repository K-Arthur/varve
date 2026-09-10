/**
 * Demo sample document: schema-valid, structurally stable, and idempotently seeded.
 */

import { createMemoryPlatform } from '@varve/platform';
import {
  createDocument,
  DocumentCodec,
  resetDefaultIdRng,
  serializeDocument,
  setDefaultIdRng,
} from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildDemoSampleDocument,
  DEMO_SAMPLE_DOCUMENT_NAME,
  DEMO_SAMPLE_FILE_ID,
  makeDemoSampleEntry,
  seedDemoSample,
} from './sampleDocument';

let idCounter = 0;

describe('demo sample document', () => {
  beforeEach(() => {
    idCounter = 0;
    setDefaultIdRng(() => `fixed${idCounter++}`);
  });
  afterEach(() => {
    resetDefaultIdRng();
  });

  it('serializes to a valid document at the current schema version', () => {
    const doc = buildDemoSampleDocument();
    const json = serializeDocument(doc);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.document.name).toBe(DEMO_SAMPLE_DOCUMENT_NAME);
    }
  });

  it('is structurally deterministic: same serialized output on every call', () => {
    const jsonA = serializeDocument(buildDemoSampleDocument());
    idCounter = 0;
    const jsonB = serializeDocument(buildDemoSampleDocument());
    expect(jsonA).toBe(jsonB);
  });

  it('contains a poster frame with shapes and text', () => {
    const doc = buildDemoSampleDocument();
    const ids = Object.keys(doc.nodes);
    expect(ids.length).toBeGreaterThanOrEqual(9);
    const kinds = ids.map((id) => doc.nodes[id]!.kind);
    expect(kinds).toContain('frame');
    expect(kinds).toContain('shape');
    expect(kinds).toContain('text');
    const frame = ids.find((id) => doc.nodes[id]!.kind === 'frame');
    expect(frame).toBeTruthy();
  });

  it('has a stable library id and entry metadata', () => {
    const entry = makeDemoSampleEntry(1234);
    expect(entry.id).toBe(DEMO_SAMPLE_FILE_ID);
    expect(entry.name).toBe(DEMO_SAMPLE_DOCUMENT_NAME);
    expect(entry.kind).toBe('strata');
    expect(entry.createdAt).toBe(1234);
    expect(entry.contentHash).toMatch(/^[0-9a-f]+$/);
  });

  it('seeds once and never overwrites an existing (possibly edited) sample', async () => {
    const platform = createMemoryPlatform();
    const first = await seedDemoSample(platform);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.seeded).toBe(true);

    // Simulate a user edit: persist different content under the same id.
    const edited = serializeDocument(createDocument('User edited', { flat: true }));
    await platform.upsertFile(first.entry, edited);

    const second = await seedDemoSample(platform);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.seeded).toBe(false);
    expect(second.json).toBe(edited);
  });

  it('reports a readable error when seeding fails', async () => {
    const failing = {
      readFile: async () => null,
      upsertFile: async () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      },
    } as never;
    const result = await seedDemoSample(failing as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/quota/i);
    }
  });
});
