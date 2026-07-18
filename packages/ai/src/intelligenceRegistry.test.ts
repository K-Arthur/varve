import { addSwatch, createDocument, type Document, type SceneNode } from '@strata/scene';
import { describe, expect, it, vi } from 'vitest';
import {
  dispatchIntelligence,
  INTELLIGENCE_COMMANDS,
  matchIntelligenceCommand,
} from './intelligenceRegistry';

function docWithUntokenizedColor(): Document {
  let doc = createDocument('Test');
  doc = addSwatch(doc, 'Brand', { space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
  const node: SceneNode = {
    id: 'shape-1',
    name: 'Rectangle 1',
    kind: 'shape',
    fill: { space: 'rgb', r: 10, g: 20, b: 30, a: 255 },
    shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    transform: [1, 0, 0, 1, 0, 0],
    strokes: [],
    effects: [],
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
  } as unknown as SceneNode;
  return { ...doc, nodes: { ...doc.nodes, [node.id]: node }, rootChildren: [node.id] };
}

describe('INTELLIGENCE_COMMANDS', () => {
  it('registers commands for contrast, debt, naming, and spacing', () => {
    const ids = INTELLIGENCE_COMMANDS.map((c) => c.id);
    expect(ids).toContain('check-contrast');
    expect(ids).toContain('scan-debt');
    expect(ids).toContain('suggest-names');
    expect(ids).toContain('harmonize-spacing');
  });
});

describe('matchIntelligenceCommand', () => {
  it('matches "check contrast" to check-contrast', () => {
    expect(matchIntelligenceCommand('can you check contrast for me')?.id).toBe('check-contrast');
  });

  it('matches "accessibility" and "wcag" to check-contrast', () => {
    expect(matchIntelligenceCommand('review accessibility')?.id).toBe('check-contrast');
    expect(matchIntelligenceCommand('is this WCAG compliant')?.id).toBe('check-contrast');
  });

  it('matches "scan debt" and "scan for debt" to scan-debt', () => {
    expect(matchIntelligenceCommand('scan debt')?.id).toBe('scan-debt');
    expect(matchIntelligenceCommand('please scan for design debt')?.id).toBe('scan-debt');
  });

  it('matches "name layers" and "rename layers" to suggest-names', () => {
    expect(matchIntelligenceCommand('name layers for me')?.id).toBe('suggest-names');
    expect(matchIntelligenceCommand('rename layers')?.id).toBe('suggest-names');
  });

  it('matches "harmonize spacing" to harmonize-spacing', () => {
    expect(matchIntelligenceCommand('harmonize spacing please')?.id).toBe('harmonize-spacing');
  });

  it('returns null for an unrelated message', () => {
    expect(matchIntelligenceCommand('what is the capital of France')).toBeNull();
  });
});

describe('dispatchIntelligence', () => {
  it('runs a real contrast audit against the document', () => {
    const doc = docWithUntokenizedColor();
    const result = dispatchIntelligence('check contrast', { document: doc });
    expect(result).not.toBeNull();
    expect(result?.id).toBe('check-contrast');
    expect(typeof result?.summary).toBe('string');
  });

  it('runs a real debt scan against the document', () => {
    const doc = docWithUntokenizedColor();
    const result = dispatchIntelligence('scan for debt', { document: doc });
    expect(result?.id).toBe('scan-debt');
    expect(result?.summary).toMatch(/\d+/);
  });

  it('delegates naming to the supplied editor handler', () => {
    const suggestNames = vi.fn(() => 'Renamed 3 layers');
    const doc = docWithUntokenizedColor();
    const result = dispatchIntelligence('rename layers', {
      document: doc,
      handlers: { suggestNames },
    });
    expect(suggestNames).toHaveBeenCalled();
    expect(result?.summary).toBe('Renamed 3 layers');
  });

  it('delegates spacing to the supplied editor handler', () => {
    const harmonizeSpacing = vi.fn(() => 'Harmonized spacing to 8px');
    const doc = docWithUntokenizedColor();
    const result = dispatchIntelligence('harmonize spacing', {
      document: doc,
      handlers: { harmonizeSpacing },
    });
    expect(harmonizeSpacing).toHaveBeenCalled();
    expect(result?.summary).toBe('Harmonized spacing to 8px');
  });

  it('returns a helpful message when an editor-only handler is missing', () => {
    const doc = docWithUntokenizedColor();
    const result = dispatchIntelligence('rename layers', { document: doc });
    expect(result?.id).toBe('suggest-names');
    expect(result?.summary).toMatch(/only available/i);
  });

  it('returns null when no command matches', () => {
    const doc = docWithUntokenizedColor();
    expect(dispatchIntelligence('tell me a joke', { document: doc })).toBeNull();
  });
});
