/**
 * Load halloween-cookies.varve through the same codec + migration path
 * the 0.5.0 app uses when opening a file. An earlier run claimed the
 * file loaded when DocumentCodec.decode had not actually been exercised
 * against the committed bytes.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { DocumentCodec } from '../documentCodec';
import type { FrameNode, GroupNode, TextNode } from '../types';
import { migrateDocumentDetailed } from '../version';

const VARVE_PATH = resolve(process.cwd(), 'marketing/sample-comic/halloween-cookies.varve');

async function loadRaw(): Promise<string> {
  return readFile(VARVE_PATH, 'utf-8');
}

function expectOk(result: ReturnType<typeof DocumentCodec.decode>): Document {
  expect(result.ok, result.ok ? undefined : result.error).toBe(true);
  if (!result.ok) throw new Error(result.error);
  const errors = result.warnings.filter((warning) => warning.severity === 'error');
  expect(errors).toEqual([]);
  return result.document;
}

describe('halloween-cookies.varve app load path', () => {
  it('decodes through DocumentCodec (parse + migrate + validate)', async () => {
    const json = await loadRaw();
    const result = DocumentCodec.decode(json);
    const doc = expectOk(result);

    expect(doc.formatVersion).toBe('2.33');
    expect(doc.name).toBe('Halloween Cookies');
    expect(doc.designCanvases).toHaveLength(1);
    expect(doc.activeDesignCanvasId).toBe(doc.designCanvases?.[0]?.id);

    const canvas = doc.designCanvases?.[0];
    expect(canvas?.contentRoot).toBeTruthy();
    const contentRoot = doc.nodes[canvas!.contentRoot];
    expect(contentRoot?.kind).toBe('group');
  });

  it('migrates the raw JSON with no errors', async () => {
    const raw = JSON.parse(await loadRaw()) as unknown;
    const migration = migrateDocumentDetailed(raw);
    expect(migration).not.toBeNull();
    expect(migration?.toVersion).toBe('2.33');
    expect(migration?.warnings.filter((warning) => /error/i.test(warning))).toEqual([]);
  });

  it('round-trips encode then decode without errors', async () => {
    const first = expectOk(DocumentCodec.decode(await loadRaw()));
    const encoded = DocumentCodec.encode(first);
    const second = expectOk(DocumentCodec.decode(encoded));
    expect(second.name).toBe(first.name);
    expect(Object.keys(second.nodes).length).toBe(Object.keys(first.nodes).length);
    expect(second.designCanvases?.[0]?.id).toBe(first.designCanvases?.[0]?.id);
  });

  it('has six semantic panels and string text nodes', async () => {
    const doc = expectOk(DocumentCodec.decode(await loadRaw()));
    const panels = Object.values(doc.nodes).filter(
      (node): node is FrameNode => node.kind === 'frame' && node.panel?.version === 1,
    );
    expect(panels).toHaveLength(6);
    for (const panel of panels) {
      expect(panel.clipContent).toBe(true);
      expect(panel.w).toBeGreaterThan(300);
      expect(panel.h).toBeGreaterThan(300);
    }

    const textNodes = Object.values(doc.nodes).filter(
      (node): node is TextNode => node.kind === 'text',
    );
    expect(textNodes.length).toBeGreaterThan(0);
    for (const node of textNodes) {
      expect(typeof node.text).toBe('string');
      expect(node.text.length).toBeGreaterThan(0);
      expect(node.fontFamily).toMatch(/IBM Plex|Plex Sans/);
    }
  });

  it('has speech, thought, shout, and caption callouts with valid refs', async () => {
    const doc = expectOk(DocumentCodec.decode(await loadRaw()));
    const callouts = Object.values(doc.nodes).filter(
      (node): node is GroupNode => node.kind === 'group' && !!node.callout,
    );
    expect(callouts.map((node) => node.callout?.kind).sort()).toEqual([
      'caption',
      'caption',
      'shout',
      'speech',
      'thought',
    ]);

    for (const group of callouts) {
      const callout = group.callout!;
      expect(doc.nodes[callout.bodyNodeId]?.kind).toBe('shape');
      const text = doc.nodes[callout.textNodeId];
      expect(text?.kind).toBe('text');
      if (text?.kind === 'text') expect(typeof text.text).toBe('string');
      for (const tailId of callout.tailNodeIds ?? []) {
        const tail = doc.nodes[tailId];
        expect(tail).toBeDefined();
        expect(['path', 'shape']).toContain(tail?.kind);
      }
    }
  });

  it('has a clipped shading layer in every panel', async () => {
    const doc = expectOk(DocumentCodec.decode(await loadRaw()));
    const panels = Object.values(doc.nodes).filter(
      (node): node is FrameNode => node.kind === 'frame' && node.panel?.version === 1,
    );
    expect(panels).toHaveLength(6);

    const shadeGroups = Object.values(doc.nodes).filter(
      (node): node is GroupNode =>
        node.kind === 'group' && node.mask?.type === 'clip' && /shade/i.test(node.name),
    );
    expect(shadeGroups.length).toBeGreaterThanOrEqual(6);
  });
});
