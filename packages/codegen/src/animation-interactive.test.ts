import { addInteraction, addNode, createDocument, makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { exportInteractiveAnimations } from './animation-interactive';

describe('exportInteractiveAnimations', () => {
  it('emits navigate handler referencing targetId', () => {
    let doc = createDocument();
    const { doc: next } = addInteraction(doc, 'btn1', {
      name: 'Go home',
      trigger: { kind: 'onClick' },
      actions: [
        {
          kind: 'navigateTo',
          targetId: 'f2',
          transition: { kind: 'instant', duration: 0, easing: { kind: 'linear' } },
        },
      ],
      enabled: true,
    });
    doc = next;
    const result = exportInteractiveAnimations(doc);
    expect(result.reactHandlers).toContain('Go home');
    expect(result.reactHandlers).toContain("navigate('/screen/f2')");
    expect(result.reactHandlers).toContain('onClick');
  });

  it('includes css scroll binding for scroll triggers when requested', () => {
    let doc = createDocument();
    doc = addNode(doc, makeShapeNode('hero', { kind: 'rect', x: 0, y: 0, w: 100, h: 40 }));
    const { doc: withIx } = addInteraction(doc, 'hero', {
      name: 'Parallax',
      trigger: { kind: 'onScroll' },
      actions: [{ kind: 'toggleVisibility' }],
      enabled: true,
    });
    const result = exportInteractiveAnimations(withIx, { useScrollTimeline: true });
    expect(result.cssBindings).toContain('animation-timeline: view()');
    expect(result.cssBindings).toContain('[data-strata-node="hero"]');
  });

  it('skips disabled interactions', () => {
    const doc = createDocument();
    const { doc: next } = addInteraction(doc, 'n1', {
      name: 'Disabled',
      trigger: { kind: 'onClick' },
      actions: [
        {
          kind: 'navigateTo',
          targetId: 'f1',
          transition: { kind: 'instant', duration: 0, easing: { kind: 'linear' } },
        },
      ],
      enabled: false,
    });
    const result = exportInteractiveAnimations(next);
    expect(result.reactHandlers).not.toContain('Disabled');
  });
});
