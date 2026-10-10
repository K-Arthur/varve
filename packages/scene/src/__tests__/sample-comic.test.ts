/**
 * Validate the generated comic document
 */

import { readFile } from 'node:fs/promises';
import { DocumentCodec } from '@varve/scene';
import { describe, expect, it } from 'vitest';

describe('halloween-cookies.varve', () => {
  it('should decode successfully', async () => {
    const json = await readFile('marketing/sample-comic/halloween-cookies.varve', 'utf-8');
    const result = DocumentCodec.decode(json);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.name).toBe('Halloween Cookies');
    expect(Object.keys(result.document.nodes).length).toBeGreaterThan(0);
  });

  it('should have valid text nodes', async () => {
    const json = await readFile('marketing/sample-comic/halloween-cookies.varve', 'utf-8');
    const result = DocumentCodec.decode(json);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const textNodes = Object.values(result.document.nodes).filter(
      (n): n is Extract<typeof n, { kind: 'text' }> => n.kind === 'text',
    );

    expect(textNodes.length).toBeGreaterThan(0);

    for (const node of textNodes) {
      expect(typeof node.text).toBe('string');
      expect(node.text).toBeTruthy();
    }
  });

  it('should have valid callout groups', async () => {
    const json = await readFile('marketing/sample-comic/halloween-cookies.varve', 'utf-8');
    const result = DocumentCodec.decode(json);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const callouts = Object.values(result.document.nodes).filter(
      (n): n is Extract<typeof n, { kind: 'group' }> => n.kind === 'group' && !!n.callout,
    );

    expect(callouts.length).toBe(5); // Speech, thought, shout, and 2 captions

    for (const callout of callouts) {
      expect(callout.callout).toBeDefined();
      expect(callout.callout?.bodyNodeId).toBeTruthy();
      expect(callout.callout?.textNodeId).toBeTruthy();
      expect(callout.callout?.tailNodeIds).toBeDefined();
      expect(callout.callout?.tails).toBeDefined();

      // Verify referenced nodes exist
      const bodyNode = result.document.nodes[callout.callout!.bodyNodeId];
      expect(bodyNode).toBeDefined();
      expect(bodyNode?.kind).toBe('shape');

      const textNode = result.document.nodes[callout.callout!.textNodeId];
      expect(textNode).toBeDefined();
      expect(textNode?.kind).toBe('text');
      if (textNode?.kind === 'text') {
        expect(typeof textNode.text).toBe('string');
      }
    }
  });
});
