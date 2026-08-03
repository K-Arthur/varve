/**
 * Unit tests for logo audit rules — advisory checks over logo projects.
 */
import { describe, expect, it } from 'vitest';
import { registerBuiltinRules } from '../auditAdapter';
import type { AuditContext } from '../auditEngine';
import { getAllRules } from '../auditEngine';
import type { Document } from '../document';
import { createDocument, makeShapeNode, makeTextNode } from '../document';
import {
  addLogoConcept,
  addLogoVariant,
  createLogoArtboard,
  createLogoProject,
} from './logoProject';

function ctx(doc: Document): AuditContext {
  return {
    doc,
    workspaceMode: 'logo',
    canvasMode: 'full',
    tool: 'select',
    selection: [],
    isPresenting: false,
  };
}

describe('logo audit rules', () => {
  it('registers the logo rule set', () => {
    registerBuiltinRules();
    const ids = getAllRules().map((r) => r.id);
    expect(ids).toContain('logo/text-left-editable');
    expect(ids).toContain('logo/thin-strokes');
    expect(ids).toContain('logo/excessive-points');
    expect(ids).toContain('logo/missing-monochrome-variant');
  });

  it('flags editable text inside a logo project', () => {
    registerBuiltinRules();
    let doc = createDocument('Logo', true);
    doc = { ...doc, logoProject: createLogoProject('Acme') };
    const { doc: d1, artboardId } = createLogoArtboard(doc, { name: 'A', width: 400, height: 400 });
    doc = d1;
    doc = addLogoConcept(doc, { name: 'A', artboardId });
    const text = makeTextNode('t1', 'Acme');
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [artboardId]: { ...(doc.nodes[artboardId] as { children: string[] }), children: ['t1'] },
        t1: text,
      } as Record<string, import('../types').SceneNode>,
    };
    const rule = getAllRules().find((r) => r.id === 'logo/text-left-editable')!;
    const findings = rule.run(ctx(doc));
    expect(findings.length).toBe(1);
    expect(findings[0]!.nodeId).toBe('t1');
  });

  it('flags strokes thinner than 2px', () => {
    registerBuiltinRules();
    let doc = createDocument('Logo', true);
    doc = { ...doc, logoProject: createLogoProject('Acme') };
    const thin = makeShapeNode(
      's1',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      {
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
            weight: 1,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'round',
            join: 'round',
            miterLimit: 4,
            visible: true,
          },
        ],
      },
    );
    const thick = makeShapeNode(
      's2',
      { kind: 'rect', x: 20, y: 0, w: 10, h: 10 },
      {
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
            weight: 4,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'round',
            join: 'round',
            miterLimit: 4,
            visible: true,
          },
        ],
      },
    );
    doc = { ...doc, rootChildren: ['s1', 's2'], nodes: { ...doc.nodes, s1: thin, s2: thick } };
    const rule = getAllRules().find((r) => r.id === 'logo/thin-strokes')!;
    const findings = rule.run(ctx(doc));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.nodeId).toBe('s1');
  });

  it('flags paths over 2000 points', () => {
    registerBuiltinRules();
    const points = Array.from({ length: 2500 }, (_, i) => ({
      x: i % 100,
      y: Math.floor(i / 100),
      handleIn: null,
      handleOut: null,
    }));
    let doc = createDocument('Logo', true);
    doc = { ...doc, logoProject: createLogoProject('Acme') };
    const complex = makeShapeNode('c1', {
      kind: 'path',
      points,
      closed: false,
      tolerance: 2,
    });
    doc = { ...doc, rootChildren: ['c1'], nodes: { ...doc.nodes, c1: complex } };
    const rule = getAllRules().find((r) => r.id === 'logo/excessive-points')!;
    const findings = rule.run(ctx(doc));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.nodeId).toBe('c1');
  });

  it('suggests a monochrome variant only when none exists', () => {
    registerBuiltinRules();
    let doc = createDocument('Logo', true);
    doc = { ...doc, logoProject: createLogoProject('Acme') };
    doc = addLogoConcept(doc, { name: 'Primary', artboardId: null });
    const rule = getAllRules().find((r) => r.id === 'logo/missing-monochrome-variant')!;
    expect(rule.run(ctx(doc))).toHaveLength(1);

    doc = addLogoVariant(doc, {
      name: 'Mono',
      kind: 'monochrome',
      artboardId: null,
      sourceConceptId: null,
    });
    expect(rule.run(ctx(doc))).toHaveLength(0);
  });

  it('does not fire logo rules on plain documents', () => {
    registerBuiltinRules();
    const doc = createDocument('Plain', true);
    const ids = [
      'logo/text-left-editable',
      'logo/thin-strokes',
      'logo/excessive-points',
      'logo/missing-monochrome-variant',
    ];
    for (const id of ids) {
      const rule = getAllRules().find((r) => r.id === id)!;
      expect(rule.run(ctx(doc))).toEqual([]);
    }
  });
});
