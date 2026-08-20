// @vitest-environment jsdom

import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import * as prototypeA11y from '@varve/prototype';
import {
  addInteraction,
  addNode,
  addSMState,
  addSMTransition,
  createDocument,
  createStateMachine,
  createTimeline,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivePrototypeTransition } from '../components/Prototype/usePrototypeTransition';
import { usePrototypeTransition } from '../components/Prototype/usePrototypeTransition';
import { EditorProvider, useEditor } from '../context';
import { createRuntimeFromDocument, interactionsMapFromDocument } from './prototypeRuntime';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('prototypeRuntime', () => {
  it('loads interactions from document into runtime', () => {
    const doc = createDocument();
    const { doc: next } = addInteraction(doc, 'n1', {
      name: 'Navigate',
      trigger: { kind: 'onClick' },
      actions: [
        {
          kind: 'navigateTo',
          targetId: 'frame-1',
          transition: { kind: 'instant', duration: 0, easing: { kind: 'linear' } },
        },
      ],
      enabled: true,
    });

    const { runtime } = createRuntimeFromDocument(next);
    expect(runtime.interactions).toHaveLength(1);
    expect(runtime.interactions[0]?.name).toBe('Navigate');
  });

  it('interactionsMapFromDocument preserves node buckets', () => {
    const doc = createDocument();
    const { doc: next } = addInteraction(doc, 'n1', {
      name: 'A',
      trigger: { kind: 'onClick' },
      actions: [],
      enabled: true,
    });
    const map = interactionsMapFromDocument(next);
    expect(map.n1).toHaveLength(1);
  });
});

function buildNavigateDoc(transitionKind: 'smartAnimate' | 'dissolve' = 'dissolve') {
  let doc = createDocument('Nav');
  doc = addNode(doc, makeFrameNode('f1', { name: 'A', order: 'a0' }));
  doc = addNode(doc, makeFrameNode('f2', { name: 'B', order: 'a1' }));
  doc = addNode(
    doc,
    makeShapeNode(
      'hot1',
      { kind: 'rect', x: 0, y: 0, w: 80, h: 40 },
      {
        name: 'Button',
        transform: [1, 0, 0, 1, 10, 20],
      },
    ),
  );
  doc = addNode(
    doc,
    makeShapeNode(
      'hot2',
      { kind: 'rect', x: 0, y: 0, w: 80, h: 40 },
      {
        name: 'Button',
        transform: [1, 0, 0, 1, 100, 200],
      },
    ),
  );
  doc = {
    ...doc,
    rootChildren: ['f1', 'f2'],
    nodes: {
      ...doc.nodes,
      f1: { ...(doc.nodes.f1 as import('@varve/scene').FrameNode), children: ['hot1'] },
      f2: { ...(doc.nodes.f2 as import('@varve/scene').FrameNode), children: ['hot2'] },
    },
  };
  const { doc: withIx } = addInteraction(doc, 'hot1', {
    name: 'Go',
    trigger: { kind: 'onClick' },
    actions: [
      {
        kind: 'navigateTo',
        targetId: 'f2',
        transition: {
          kind: transitionKind,
          duration: 400,
          easing: { kind: 'linear' },
        },
      },
    ],
    enabled: true,
  });
  return withIx;
}

function buildStateMachineDoc() {
  let doc = createDocument('SM');
  doc = addNode(doc, makeFrameNode('f1', { name: 'Screen', order: 'a0' }));
  doc = { ...doc, rootChildren: ['f1'] };
  doc = createStateMachine(doc, 'sm-1', 'Player');
  const { doc: d1, stateId: idleId } = addSMState(doc, 'sm-1', 'Idle', 'tl-idle', true);
  doc = d1;
  const { doc: d2, stateId: activeId } = addSMState(doc, 'sm-1', 'Active', 'tl-active');
  doc = d2;
  const { doc: d3 } = addSMTransition(doc, 'sm-1', idleId!, activeId!, 'onClick');
  return d3;
}

describe('prototype editor integration', () => {
  it('sets smart animate transition state on navigateTo', async () => {
    const doc = buildNavigateDoc('smartAnimate');
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
        <Test />
      </EditorProvider>,
    );

    ctx?.updatePrototypeData();
    ctx?.handlePrototypeEvent({ type: 'click', nodeId: 'hot1', screenId: 'f1' });

    await waitFor(() => {
      expect(ctx?.prototypeTransition).not.toBeNull();
      expect(ctx?.prototypeTransition?.transition.kind).toBe('smartAnimate');
      expect(ctx?.prototypeTransition?.smartAnimateValues?.Button).toBeDefined();
      expect(ctx?.prototypeTransition?.layerMatches?.length).toBeGreaterThan(0);
    });
  });

  it('reduced motion skips transition RAF progress at 1', () => {
    vi.spyOn(prototypeA11y, 'prefersReducedMotion').mockReturnValue(true);

    const transition: ActivePrototypeTransition = {
      fromScreenId: 'f1',
      toScreenId: 'f2',
      transition: { kind: 'dissolve', duration: 300, easing: { kind: 'linear' } },
      startedAt: performance.now(),
    };

    const { result } = renderHook(() => usePrototypeTransition(transition));
    expect(result.current).toBe(1);
  });

  it('SM click updates activeTimelineId when state has timelineId', async () => {
    const doc = buildStateMachineDoc();
    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
        <Test />
      </EditorProvider>,
    );

    ctx?.startPresentation();
    await waitFor(() => expect(ctx?.state.isPresenting).toBe(true));
    expect(ctx?.state.motion.activeTimelineId).toBe('tl-idle');

    act(() => {
      ctx?.handlePrototypeEvent({ type: 'click', nodeId: 'f1', screenId: 'f1' });
    });

    await waitFor(() => {
      expect(ctx?.state.motion.activeTimelineId).toBe('tl-active');
    });
  });

  it('startAnimation action plays the referenced timeline', async () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'Screen', order: 'a0' }));
    doc = { ...doc, rootChildren: ['f1'] };
    const { doc: docTl, id: timelineId } = createTimeline(doc, 'Spin', 1000);
    doc = docTl;
    const { doc: withIx } = addInteraction(doc, 'f1', {
      name: 'Play',
      trigger: { kind: 'onClick' },
      actions: [{ kind: 'startAnimation', targetId: 'f1', animationId: timelineId }],
      enabled: true,
    });

    let ctx: ReturnType<typeof useEditor> | undefined;
    function Test() {
      ctx = useEditor();
      return null;
    }
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(withIx)}>
        <Test />
      </EditorProvider>,
    );

    ctx?.updatePrototypeData();
    act(() => {
      ctx?.handlePrototypeEvent({ type: 'click', nodeId: 'f1', screenId: 'f1' });
    });

    await waitFor(() => {
      expect(ctx?.state.motion.activeTimelineId).toBe(timelineId);
      expect(ctx?.state.motion.isPlaying).toBe(true);
    });
  });
});
