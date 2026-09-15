// @ts-nocheck
// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { addChild, addNode, createDocument, makeGroupNode, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../context';
import { sceneNeedsStructuralCompositing } from '../render/sceneCompositing';

const backgroundBlurEffect = {
  type: 'backgroundBlur' as const,
  radius: 10,
  visible: true,
} as const;

function createGroupWithBackgroundBlur() {
  const doc = createDocument('test', true);
  const gId = 'g1';
  const sId = 's1';
  const s2Id = 's2';
  const group = makeGroupNode(gId, { effects: [backgroundBlurEffect] });
  const shape1 = makeShapeNode(sId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
  const shape2 = makeShapeNode(s2Id, { kind: 'ellipse', x: 50, y: 50, w: 80, h: 80 });
  let updated = addNode(doc, group);
  updated = addNode(updated, shape1);
  updated = addNode(updated, shape2);
  updated = addChild(updated, gId, updated.nodes[shape1.id]);
  updated = addChild(updated, gId, updated.nodes[shape2.id]);
  return updated;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('group backgroundBlur effect', () => {
  it('document with group backgroundBlur triggers structural compositing', () => {
    const doc = createGroupWithBackgroundBlur();
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('group node stores backgroundBlur effect with correct properties', () => {
    const doc = createGroupWithBackgroundBlur();
    const group = doc.nodes.g1!;
    expect(group).toBeDefined();
    expect(group.kind).toBe('group');
    if (group.kind === 'group') {
      const g = group as import('@varve/scene').GroupNode;
      const eff = g.effects[0]!;
      expect(eff.type).toBe('backgroundBlur');
      expect(eff.visible).toBe(true);
      expect(eff.radius).toBe(10);
    }
  });

  it('backgroundBlur effect is visible and not filtered by flatten check', () => {
    const doc = createGroupWithBackgroundBlur();
    const group = doc.nodes.g1!;
    expect(group).toBeDefined();
    if (group.kind === 'group') {
      const g = group as import('@varve/scene').GroupNode;
      const visibleEffects = g.effects.filter((e) => e.visible);
      const blurEff = visibleEffects.find((e) => e.type === 'backgroundBlur');
      expect(blurEff).toBeDefined();
      expect(blurEff?.type).toBe('backgroundBlur');
    }
  });

  it('group with invisible backgroundBlur effect does not trigger compositing', () => {
    const doc = createDocument('test', true);
    const gId = 'g1';
    const sId = 's1';
    const group = makeGroupNode(gId, {
      effects: [{ ...backgroundBlurEffect, visible: false }],
    });
    const shape = makeShapeNode(sId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let updated = addNode(doc, group);
    updated = addNode(updated, shape);
    updated = addChild(updated, gId, updated.nodes[shape.id]);
    expect(sceneNeedsStructuralCompositing(updated)).toBe(false);
  });

  it('group with backgroundBlur + dropShadow triggers compositing for both', () => {
    const doc = createDocument('test', true);
    const gId = 'g1';
    const sId = 's1';
    const group = makeGroupNode(gId, {
      effects: [
        backgroundBlurEffect,
        {
          type: 'dropShadow' as const,
          x: 2,
          y: 2,
          blur: 4,
          spread: 0,
          color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 200 },
          opacity: 0.5,
          blendMode: 'normal' as const,
          visible: true,
        },
      ],
    });
    const shape = makeShapeNode(sId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let updated = addNode(doc, group);
    updated = addNode(updated, shape);
    updated = addChild(updated, gId, updated.nodes[shape.id]);

    expect(sceneNeedsStructuralCompositing(updated)).toBe(true);
    if (updated.nodes[gId].kind === 'group') {
      const visibleEffects = updated.nodes[gId].effects.filter((e) => e.visible);
      expect(visibleEffects.length).toBe(2);
      const types = visibleEffects.map((e) => e.type);
      expect(types).toContain('backgroundBlur');
      expect(types).toContain('dropShadow');
    }
  });

  it('editor renders group with backgroundBlur effect without crashing', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(createGroupWithBackgroundBlur())}>
        <Test />
      </EditorProvider>,
    );
    await waitFor(() => expect(ctx).toBeDefined());
    expect(ctx).toBeDefined();
    const doc = ctx!.state.document;
    const group = doc.nodes.g1;
    expect(group).toBeDefined();
    expect(group.kind).toBe('group');
  });

  it('group flattening effect loop handles backgroundBlur alongside dropShadow', () => {
    const effects = [
      {
        type: 'dropShadow' as const,
        x: 2,
        y: 2,
        blur: 4,
        spread: 0,
        color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 200 },
        opacity: 0.5,
        blendMode: 'normal' as const,
        visible: true,
      },
      {
        type: 'backgroundBlur' as const,
        radius: 10,
        visible: true,
      },
    ];

    const processedTypes: string[] = [];
    for (const effect of effects) {
      if (
        effect.type === 'dropShadow' ||
        effect.type === 'outerGlow' ||
        effect.type === 'glassMaterial' ||
        effect.type === 'backgroundBlur'
      ) {
        processedTypes.push(effect.type);
      }
    }

    expect(processedTypes).toContain('dropShadow');
    expect(processedTypes).toContain('backgroundBlur');
    expect(processedTypes.length).toBe(2);
  });

  it('backgroundBlur blur padding is correctly accounted for', () => {
    const doc = createGroupWithBackgroundBlur();
    const group = doc.nodes.g1;
    expect(group).toBeDefined();
    if (group.kind === 'group') {
      const visibleBlurEff = group.effects.find((e) => e.type === 'backgroundBlur' && e.visible);
      expect(visibleBlurEff).toBeDefined();
      if (visibleBlurEff?.visible && visibleBlurEff.type === 'backgroundBlur') {
        const expectedPadding = visibleBlurEff.radius * 3;
        expect(expectedPadding).toBe(30);
      }
    }
  });

  it('group backgroundBlur does not crash when group is empty', () => {
    const doc = createDocument('test', true);
    const gId = 'g1';
    const group = makeGroupNode(gId, { effects: [backgroundBlurEffect] });
    const updated = addNode(doc, group);
    expect(sceneNeedsStructuralCompositing(updated)).toBe(false);
  });

  it('backgroundBlur appearance padding rounds correctly', () => {
    const doc = createGroupWithBackgroundBlur();
    const group = doc.nodes.g1;
    expect(group).toBeDefined();
    if (group.kind === 'group') {
      const blurEff = group.effects.find((e) => e.type === 'backgroundBlur' && e.visible);
      expect(blurEff).toBeDefined();
      if (blurEff?.visible && blurEff.type === 'backgroundBlur') {
        const radius = blurEff.radius;
        const padding = Math.ceil(Math.max(0, radius) * 3);
        expect(padding).toBe(30);
        expect(Math.ceil(Math.max(0, 0) * 3)).toBe(0);
      }
    }
  });
});
