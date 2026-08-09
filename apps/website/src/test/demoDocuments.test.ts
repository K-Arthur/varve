import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEMO_DOCUMENTS,
  encodeDemoDocument,
} from '../../../../scripts/screenshots/demo-document.ts';

/**
 * Demo document fixtures for the product screenshot pipeline.
 *
 * The screenshots are captured by opening real Varve documents in the real
 * editor. Those documents are authored in `scripts/screenshots/demo-document.ts`
 * and committed as encoded `.varve` fixtures so the capture script (plain
 * Node, no TypeScript loader) can read them directly.
 *
 * This test is the anti-drift guard: it re-encodes every document from source
 * and compares it with the committed fixture. If the generator or the document
 * codec changes, this fails with the exact command to regenerate:
 *
 *   UPDATE_DEMO_DOCS=1 pnpm test:website
 *
 * Regenerating is deliberately an explicit action — the fixtures are inputs to
 * binary screenshot captures, so they should never change silently.
 */

const FIXTURE_DIR = path.resolve(__dirname, '../../../../scripts/screenshots/fixtures');
const UPDATE = process.env.UPDATE_DEMO_DOCS === '1';

describe('demo document fixtures', () => {
  const names = Object.keys(DEMO_DOCUMENTS);

  it('exposes the documents the capture scenes rely on', () => {
    expect(names).toEqual(expect.arrayContaining(['poster', 'vector', 'type', 'layout']));
  });

  it.each(names)('%s matches its committed .varve fixture', (name) => {
    const encoded = encodeDemoDocument(name);
    const file = path.join(FIXTURE_DIR, `${name}.varve`);

    if (UPDATE) {
      fs.mkdirSync(FIXTURE_DIR, { recursive: true });
      fs.writeFileSync(file, `${encoded}\n`);
    }

    expect(fs.existsSync(file), `${file} missing — run UPDATE_DEMO_DOCS=1 pnpm test:website`).toBe(
      true,
    );
    expect(
      fs.readFileSync(file, 'utf8').trim(),
      `${name}.varve is stale — run UPDATE_DEMO_DOCS=1 pnpm test:website`,
    ).toBe(encoded);
  });

  it('documents are deterministic across builds', () => {
    for (const name of names) {
      expect(encodeDemoDocument(name)).toBe(encodeDemoDocument(name));
    }
  });

  it('every document carries renderable content', () => {
    for (const name of names) {
      const doc = JSON.parse(encodeDemoDocument(name)) as {
        rootChildren: string[];
        nodes: Record<string, unknown>;
      };
      expect(doc.rootChildren.length, `${name} roots`).toBeGreaterThan(0);
      expect(Object.keys(doc.nodes).length, `${name} nodes`).toBeGreaterThan(2);
    }
  });
});
