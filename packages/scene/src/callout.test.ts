import { describe, expect, it } from 'vitest';
import { deepCloneSubtree } from './clone';
import {
  addCalloutTail,
  addNode,
  createCallout,
  createDocument,
  detachCalloutRecipe,
  fitCalloutToText,
  flipCalloutTail,
  getCalloutFitReport,
  getParent,
  makeTextNode,
  removeCalloutTail,
  setCalloutTailBaseWidth,
  setCalloutTailCurve,
  setCalloutWrapShape,
  updateCalloutKind,
  updateCalloutPadding,
  updateCalloutTailEndpoint,
  wrapTextInCallout,
} from './index';
import type { GroupNode } from './types';

describe('comic callouts', () => {
  it('creates ordinary body, tail, and editable text children', () => {
    const result = createCallout(createDocument('callout', true), {
      x: 40,
      y: 60,
      w: 240,
      h: 100,
      text: 'Hello',
    });
    const group = result.document.nodes[result.groupId] as GroupNode;
    expect(group?.kind).toBe('group');
    expect(group?.callout?.textNodeId).toBe(result.textId);
    expect(group?.children).toEqual([result.bodyId, ...result.tailNodeIds, result.textId]);
    expect(result.document.nodes[result.bodyId]?.kind).toBe('shape');
    expect(result.document.nodes[result.tailNodeIds[0]!]?.kind).toBe('path');
    expect(result.document.nodes[result.textId]?.kind).toBe('text');
  });

  it('wraps existing text without duplicating its source node', () => {
    const text = makeTextNode('text-1', 'Dialogue', {
      transform: [1, 0, 0, 1, 80, 90],
      w: 160,
      h: 48,
    });
    const doc = addNode(createDocument('wrap', true), text);
    const result = wrapTextInCallout(doc, text.id, { kind: 'caption' });
    expect(result).not.toBeNull();
    const wrapped = result!;
    expect(wrapped.document.nodes[text.id]?.kind).toBe('text');
    expect((wrapped.document.nodes[wrapped.groupId] as GroupNode).callout?.textNodeId).toBe(
      text.id,
    );
    expect(getParent(wrapped.document, text.id)).toBe(wrapped.groupId);
    expect(
      Object.values(wrapped.document.nodes).filter((node) => node.kind === 'text'),
    ).toHaveLength(1);
  });

  it('changes recipe styling and padding without replacing identities', () => {
    const created = createCallout(createDocument('style', true), {
      x: 0,
      y: 0,
      w: 100,
      h: 60,
      text: 'Hi',
    });
    let doc = updateCalloutKind(created.document, created.groupId, 'shout');
    doc = updateCalloutPadding(doc, created.groupId, 24);
    const group = doc.nodes[created.groupId] as GroupNode;
    expect(group?.callout?.kind).toBe('shout');
    expect(group?.callout?.padding).toBe(24);
    expect(group?.callout?.bodyNodeId).toBe(created.bodyId);
    expect(group?.callout?.textNodeId).toBe(created.textId);
  });

  it('supports multiple tails and editable tail endpoints', () => {
    const created = createCallout(createDocument('tails', true), {
      x: 0,
      y: 0,
      w: 100,
      h: 60,
    });
    const withSecondTail = addCalloutTail(created.document, created.groupId, { x: 80, y: 110 });
    const group = withSecondTail.nodes[created.groupId] as GroupNode;
    expect(group?.callout?.tailNodeIds).toHaveLength(2);
    const secondTail = group?.callout?.tailNodeIds[1];
    expect(secondTail).toBeDefined();
    const moved = updateCalloutTailEndpoint(withSecondTail, created.groupId, secondTail!, {
      x: 88,
      y: 124,
    });
    const tail = moved.nodes[secondTail!];
    expect(tail?.kind === 'path' ? tail.points.at(-1) : undefined).toMatchObject({ x: 88, y: 124 });
  });

  it('marks a callout detached while retaining ordinary geometry', () => {
    const created = createCallout(createDocument('detach', true), {
      x: 0,
      y: 0,
      w: 100,
      h: 60,
    });
    const doc = detachCalloutRecipe(created.document, created.groupId);
    expect((doc.nodes[created.groupId] as GroupNode).callout?.parametric).toBe(false);
    expect(doc.nodes[created.bodyId]?.kind).toBe('shape');
  });

  it('fits body geometry around the bound text without changing text', () => {
    const created = createCallout(createDocument('fit', true), {
      x: 0,
      y: 0,
      w: 200,
      h: 120,
      text: 'Fit me',
    });
    const before = created.document.nodes[created.textId];
    const doc = fitCalloutToText(created.document, created.groupId);
    expect(doc.nodes[created.textId]).toMatchObject({
      id: created.textId,
      kind: 'text',
      text: before?.kind === 'text' ? before.text : undefined,
    });
    expect((doc.nodes[created.groupId] as GroupNode).callout?.fitToText).toBe(true);
    expect((doc.nodes[created.groupId] as GroupNode).callout?.fitPolicy).toBe('fit-balloon');
  });

  it('reports overflow from shared text geometry without mutating the document', () => {
    const created = createCallout(createDocument('overflow', true), {
      x: 0,
      y: 0,
      w: 96,
      h: 48,
      padding: 12,
      text: 'This dialogue is deliberately much longer than the balloon.',
    });
    const before = created.document.nodes[created.groupId];
    const report = getCalloutFitReport(created.document, created.groupId);
    expect(report?.status).toBe('overflow');
    expect(report?.policy).toBe('reflow');
    expect(created.document.nodes[created.groupId]).toBe(before);
  });

  it('moves tail bases when the balloon grows but keeps tail targets', () => {
    const created = createCallout(createDocument('grow', true), {
      x: 0,
      y: 0,
      w: 80,
      h: 40,
      text: 'A very long line that needs more room',
      tailEndpoint: { x: 12, y: 600 },
    });
    const beforeTail = created.document.nodes[created.tailNodeIds[0]!];
    const beforeEndpoint = beforeTail?.kind === 'path' ? beforeTail.points.at(-1) : null;
    const doc = fitCalloutToText(created.document, created.groupId);
    const afterTail = doc.nodes[created.tailNodeIds[0]!];
    expect(afterTail?.kind === 'path' ? afterTail.points.at(-1) : null).toEqual(beforeEndpoint);
    expect(afterTail?.kind === 'path' ? afterTail.points[0] : null).not.toEqual(
      beforeTail?.kind === 'path' ? beforeTail.points[0] : null,
    );
  });

  it('defaults round balloon types to a balloon contour and captions to a rectangle', () => {
    const speech = createCallout(createDocument('contour-speech', true), {
      x: 0,
      y: 0,
      w: 220,
      h: 140,
      text: 'Stay close.',
    });
    const speechText = speech.document.nodes[speech.textId];
    expect(speechText?.kind === 'text' ? speechText.textWrapShape : undefined).toBe('ellipse');

    const caption = createCallout(createDocument('contour-caption', true), {
      x: 0,
      y: 0,
      w: 220,
      h: 140,
      kind: 'caption',
      text: 'Three days earlier.',
    });
    const captionText = caption.document.nodes[caption.textId];
    expect(captionText?.kind === 'text' ? captionText.textWrapShape : undefined).toBe('rect');
  });

  it('applies the contour to existing text when it is wrapped into a balloon', () => {
    const text = makeTextNode('text-contour', 'I should not have said that.', {
      transform: [1, 0, 0, 1, 60, 70],
      w: 180,
      h: 90,
      textResizing: 'fixed',
    });
    const doc = addNode(createDocument('contour-wrap', true), text);
    const result = wrapTextInCallout(doc, text.id, { kind: 'speech' });
    expect(result).not.toBeNull();
    const wrapped = result!.document.nodes[text.id];
    expect(wrapped?.kind === 'text' ? wrapped.textWrapShape : undefined).toBe('ellipse');
  });

  it('switches the line shape without resizing the body and reports the active shape', () => {
    const created = createCallout(createDocument('contour-switch', true), {
      x: 0,
      y: 0,
      w: 260,
      h: 160,
      text: 'Wait for me at the station.',
    });
    const bodyBefore = created.document.nodes[created.bodyId];
    const switched = setCalloutWrapShape(created.document, created.groupId, 'rect');
    expect(switched.nodes[created.bodyId]).toBe(bodyBefore);
    expect(getCalloutFitReport(switched, created.groupId)?.wrapShape).toBe('rect');
    const back = setCalloutWrapShape(switched, created.groupId, 'ellipse');
    expect(getCalloutFitReport(back, created.groupId)?.wrapShape).toBe('ellipse');
  });

  it('follows the kind default until the author explicitly overrides the line shape', () => {
    const created = createCallout(createDocument('contour-defaults', true), {
      x: 0,
      y: 0,
      w: 260,
      h: 160,
      text: 'Wait for me at the station.',
    });
    expect(getCalloutFitReport(created.document, created.groupId)?.wrapShape).toBe('ellipse');

    const caption = updateCalloutKind(created.document, created.groupId, 'caption');
    expect(getCalloutFitReport(caption, created.groupId)?.wrapShape).toBe('rect');
    const speechAgain = updateCalloutKind(caption, created.groupId, 'speech');
    expect(getCalloutFitReport(speechAgain, created.groupId)?.wrapShape).toBe('ellipse');

    // An explicit choice is an override: it survives later style changes.
    const overridden = setCalloutWrapShape(speechAgain, created.groupId, 'rect');
    const shout = updateCalloutKind(overridden, created.groupId, 'shout');
    expect(getCalloutFitReport(shout, created.groupId)?.wrapShape).toBe('rect');
  });

  it('fits a contour balloon tightly around dialogue without touching text or tail target', () => {
    const created = createCallout(createDocument('contour-fit', true), {
      x: 0,
      y: 0,
      w: 420,
      h: 320,
      text: 'No, that is not what I meant at all.',
      tailEndpoint: { x: 30, y: 400 },
    });
    const textBefore = created.document.nodes[created.textId];
    const doc = fitCalloutToText(created.document, created.groupId);
    const body = doc.nodes[created.bodyId];
    const textAfter = doc.nodes[created.textId];
    expect(
      body?.kind === 'shape' && body.shape.kind === 'rect'
        ? body.shape.w
        : Number.POSITIVE_INFINITY,
    ).toBeLessThan(420);
    expect(
      body?.kind === 'shape' && body.shape.kind === 'rect'
        ? body.shape.h
        : Number.POSITIVE_INFINITY,
    ).toBeLessThan(320);
    expect(textAfter?.kind === 'text' ? textAfter.text : undefined).toBe(
      textBefore?.kind === 'text' ? textBefore.text : undefined,
    );
    const tail = doc.nodes[created.tailNodeIds[0]!];
    expect(tail?.kind === 'path' ? tail.points.at(-1) : null).toMatchObject({ x: 30, y: 400 });
    expect(getCalloutFitReport(doc, created.groupId)?.status).not.toBe('overflow');
  });

  it('builds a thought-balloon tail as a chain of decreasing circles at the target', () => {
    const created = createCallout(createDocument('thought-chain', true), {
      x: 0,
      y: 0,
      w: 160,
      h: 100,
      kind: 'thought',
      text: 'Hmm.',
      tailEndpoint: { x: 40, y: 180 },
    });
    expect(created.tailNodeIds).toHaveLength(3);
    const radii = created.tailNodeIds.map((id) => {
      const node = created.document.nodes[id];
      return node?.kind === 'shape' && node.shape.kind === 'circle' ? node.shape.r : 0;
    });
    for (let index = 1; index < radii.length; index++) {
      expect(radii[index]!).toBeLessThan(radii[index - 1]!);
      expect(radii[index]!).toBeGreaterThan(0);
    }
    const last = created.document.nodes[created.tailNodeIds.at(-1)!];
    expect(
      last?.kind === 'shape' && last.shape.kind === 'circle'
        ? { x: last.shape.cx, y: last.shape.cy }
        : null,
    ).toMatchObject({ x: 40, y: 180 });
  });

  it('bends a pointed tail without moving the tip, and straightens it again', () => {
    const created = createCallout(createDocument('tail-curve', true), {
      x: 0,
      y: 0,
      w: 160,
      h: 100,
      text: 'Over here!',
      tailEndpoint: { x: 20, y: 200 },
      tailCurve: 0.5,
    });
    const tailId = created.tailNodeIds[0]!;
    const tail = created.document.nodes[tailId];
    if (tail?.kind !== 'path') throw new Error('expected a path tail');
    expect(tail.points.at(-1)).toMatchObject({ x: 20, y: 200 });
    expect(tail.points[0]!.handleIn).not.toBeNull();
    expect(tail.points[1]!.handleOut).not.toBeNull();

    const straight = setCalloutTailCurve(created.document, created.groupId, tailId, 0);
    const straightTail = straight.nodes[tailId];
    expect(straightTail?.kind === 'path' ? straightTail.points[0]!.handleIn : 'missing').toBeNull();

    const wider = setCalloutTailBaseWidth(straight, created.groupId, tailId, 40);
    const widerTail = wider.nodes[tailId];
    if (widerTail?.kind !== 'path') throw new Error('expected a path tail');
    const baseLeft = widerTail.points[0]!;
    const baseRight = widerTail.points[1]!;
    expect(Math.abs(baseRight.x - baseLeft.x)).toBeCloseTo(40, 5);
  });

  it('flips, removes, and re-adds tails without touching the body or text', () => {
    const created = createCallout(createDocument('tail-ops', true), {
      x: 0,
      y: 0,
      w: 160,
      h: 100,
      text: 'Look out!',
      tailEndpoint: { x: 20, y: 200 },
    });
    const tailId = created.tailNodeIds[0]!;
    const bodyBefore = created.document.nodes[created.bodyId];
    const textBefore = created.document.nodes[created.textId];

    const flipped = flipCalloutTail(created.document, created.groupId, tailId);
    const flippedTail = flipped.nodes[tailId];
    expect(flippedTail?.kind === 'path' ? flippedTail.points.at(-1) : null).toMatchObject({
      x: 140,
      y: 200,
    });
    expect(flipped.nodes[created.bodyId]).toBe(bodyBefore);
    expect(flipped.nodes[created.textId]).toBe(textBefore);

    const removed = removeCalloutTail(flipped, created.groupId, tailId);
    expect(removed.nodes[tailId]).toBeUndefined();
    expect((removed.nodes[created.groupId] as GroupNode).callout?.tailNodeIds).toEqual([]);
    expect(removed.nodes[created.bodyId]).toBe(bodyBefore);

    const reAdded = addCalloutTail(removed, created.groupId, { x: 10, y: 190 });
    const reGroup = reAdded.nodes[created.groupId] as GroupNode;
    expect(reGroup.callout?.tailNodeIds).toHaveLength(1);
    expect(reGroup.children).toHaveLength(3);
  });

  it('rebuilds tails between pointed and thought styles while preserving the target', () => {
    const created = createCallout(createDocument('tail-style', true), {
      x: 0,
      y: 0,
      w: 170,
      h: 110,
      text: 'Hmm, really?',
      tailEndpoint: { x: 30, y: 210 },
    });
    const thought = updateCalloutKind(created.document, created.groupId, 'thought');
    const thoughtGroup = thought.nodes[created.groupId] as GroupNode;
    expect(thoughtGroup.callout?.tails?.[0]?.style).toBe('thought');
    expect(thoughtGroup.callout?.tailNodeIds).toHaveLength(3);
    expect(thought.nodes[created.bodyId]?.kind).toBe('shape');
    expect(thought.nodes[created.textId]?.kind).toBe('text');

    const pointed = updateCalloutKind(thought, created.groupId, 'shout');
    const pointedGroup = pointed.nodes[created.groupId] as GroupNode;
    expect(pointedGroup.callout?.tails?.[0]?.style).toBe('pointed');
    expect(pointedGroup.callout?.tailNodeIds).toHaveLength(1);
    const tipId = pointedGroup.callout!.tailNodeIds[0]!;
    const tip = pointed.nodes[tipId];
    expect(tip?.kind === 'path' ? tip.points.at(-1) : null).toMatchObject({ x: 30, y: 210 });
  });

  it('stacks auto-width dialogue into a stacked balloon instead of a ribbon', () => {
    const text = makeTextNode(
      'auto-wide',
      'Wait for me at the station. If the lights go out, take the east stairs and do not look back.',
      { transform: [1, 0, 0, 1, 40, 60] },
    );
    const doc = addNode(createDocument('auto-stack', true), text);
    const result = wrapTextInCallout(doc, text.id, { kind: 'speech' });
    expect(result).not.toBeNull();
    const wrapped = result!.document;
    const wrappedText = wrapped.nodes[text.id];
    expect(wrappedText?.kind === 'text' ? wrappedText.textResizing : undefined).toBe('fixed');
    const body = wrapped.nodes[result!.bodyId];
    const width = body?.kind === 'shape' && body.shape.kind === 'rect' ? body.shape.w : Infinity;
    // 16px type caps at ~224px of measure plus padding; the unwrapped ribbon
    // would have been several hundred px wider.
    expect(width).toBeLessThanOrEqual(280);
    // Snug by construction under the reflow policy, but never overflowing.
    expect(getCalloutFitReport(wrapped, result!.groupId)?.status).not.toBe('overflow');
  });

  it('grows a small balloon to the widest word instead of a broken column', () => {
    // Regression from the localization scenario: a 60px balloon holding a
    // long German replacement used to fit into a tall column that still
    // overflowed, because no line could hold "sichergehen".
    const created = createCallout(createDocument('grow-words', true), {
      x: 0,
      y: 0,
      w: 60,
      h: 87,
      text: 'Nein, das habe ich überhaupt nicht so gemeint — ich wollte nur sichergehen, dass wir uns verstehen.',
    });
    const doc = fitCalloutToText(created.document, created.groupId);
    const body = doc.nodes[created.bodyId];
    const width = body?.kind === 'shape' && body.shape.kind === 'rect' ? body.shape.w : 0;
    expect(width).toBeGreaterThan(60);
    expect(getCalloutFitReport(doc, created.groupId)?.status).not.toBe('overflow');
  });

  it('projects a swallowed tail tip outside the fitted body', () => {
    const created = createCallout(createDocument('tail-swallow', true), {
      x: 0,
      y: 0,
      w: 60,
      h: 80,
      text: 'Nein, das habe ich überhaupt nicht so gemeint — ich wollte nur sichergehen, dass wir uns verstehen.',
      tailEndpoint: { x: 30, y: 112 },
    });
    const doc = fitCalloutToText(created.document, created.groupId);
    const body = doc.nodes[created.bodyId];
    const tail = doc.nodes[created.tailNodeIds[0]!];
    const bodyHeight = body?.kind === 'shape' && body.shape.kind === 'rect' ? body.shape.h : 0;
    const tip = tail?.kind === 'path' ? tail.points.at(-1) : null;
    expect(tip).not.toBeNull();
    expect(Number.isFinite(tip!.x)).toBe(true);
    expect(tip!.y).toBeGreaterThan(bodyHeight);
  });

  it('keeps a thought chain attached when the balloon is fitted', () => {
    const created = createCallout(createDocument('thought-fit', true), {
      x: 0,
      y: 0,
      w: 120,
      h: 80,
      kind: 'thought',
      text: 'The east stairs, then.',
      tailEndpoint: { x: 30, y: 190 },
    });
    const doc = fitCalloutToText(created.document, created.groupId);
    const lastId = created.tailNodeIds.at(-1)!;
    const last = doc.nodes[lastId];
    expect(
      last?.kind === 'shape' && last.shape.kind === 'circle'
        ? { x: last.shape.cx, y: last.shape.cy }
        : null,
    ).toMatchObject({ x: 30, y: 190 });
    const first = doc.nodes[created.tailNodeIds[0]!];
    const body = doc.nodes[created.bodyId];
    if (
      first?.kind === 'shape' &&
      first.shape.kind === 'circle' &&
      body?.kind === 'shape' &&
      body.shape.kind === 'rect'
    ) {
      expect(first.shape.cy).toBeGreaterThan(body.shape.h - 1);
    }
  });
});

describe('shaped balloons (burst and cloud)', () => {
  it('creates a star outline behind a stroke-free body and keeps tails behind it', () => {
    const result = createCallout(createDocument('burst', true), {
      kind: 'burst',
      x: 0,
      y: 0,
      w: 220,
      h: 120,
      text: 'BOOM',
    });
    const group = result.document.nodes[result.groupId] as GroupNode;
    const outlineId = group.callout?.outlineNodeId;
    expect(outlineId).toBeDefined();
    const outline = result.document.nodes[outlineId!];
    const body = result.document.nodes[result.bodyId];
    expect(outline?.kind).toBe('shape');
    if (outline?.kind !== 'shape' || outline.shape.kind !== 'star') throw new Error('no star');
    expect(outline.shape.points).toBe(14);
    expect(outline.shape.outerRadius).toBeGreaterThan(outline.shape.innerRadius);
    expect(body?.kind).toBe('shape');
    if (body?.kind !== 'shape') throw new Error('no body');
    expect(body.strokes).toEqual([]);
    // Tails paint before the outline so their base is hidden by the balloon.
    expect(group.children?.[0]).toBe(result.tailNodeIds[0]);
    expect(group.children?.[1]).toBe(outlineId);
    expect(group.children?.[2]).toBe(result.bodyId);
  });

  it('fit keeps the outline tracking the body and the tail outside it', () => {
    const created = createCallout(createDocument('fit-burst', true), {
      kind: 'cloud',
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      text: 'A much longer line of dialogue that needs more room',
    });
    const doc = fitCalloutToText(created.document, created.groupId);
    const group = doc.nodes[created.groupId] as GroupNode;
    const outline = doc.nodes[group.callout!.outlineNodeId!];
    const body = doc.nodes[created.bodyId];
    if (outline?.kind !== 'shape' || outline.shape.kind !== 'star') throw new Error('no star');
    if (body?.kind !== 'shape' || body.shape.kind !== 'rect') throw new Error('no body');
    expect(outline.shape.points).toBe(12);
    // The star's inner core follows the fitted text container.
    expect(outline.shape.innerRadius).toBeCloseTo(Math.max(body.shape.w, body.shape.h) / 2, 1);
    const tail = doc.nodes[created.tailNodeIds[0]!];
    if (tail?.kind !== 'path') throw new Error('no tail');
    const tip = tail.points[tail.points.length - 1]!;
    expect(tip.y).toBeGreaterThan(body.shape.h);
  });

  it('switching kinds adds, updates, and removes the outline without changing identities', () => {
    const created = createCallout(createDocument('switch', true), {
      x: 0,
      y: 0,
      w: 180,
      h: 90,
      text: 'Hey',
    });
    const burst = updateCalloutKind(created.document, created.groupId, 'burst');
    const burstGroup = burst.nodes[created.groupId] as GroupNode;
    const burstOutlineId = burstGroup.callout?.outlineNodeId;
    expect(burstOutlineId).toBeDefined();
    expect(burstGroup.callout?.bodyNodeId).toBe(created.bodyId);
    expect(burstGroup.callout?.textNodeId).toBe(created.textId);

    const cloud = updateCalloutKind(burst, created.groupId, 'cloud');
    const cloudGroup = cloud.nodes[created.groupId] as GroupNode;
    expect(cloudGroup.callout?.outlineNodeId).toBe(burstOutlineId);
    const cloudOutline = cloud.nodes[burstOutlineId!];
    if (cloudOutline?.kind !== 'shape' || cloudOutline.shape.kind !== 'star') {
      throw new Error('no star');
    }
    expect(cloudOutline.shape.points).toBe(12);

    const speech = updateCalloutKind(cloud, created.groupId, 'speech');
    const speechGroup = speech.nodes[created.groupId] as GroupNode;
    expect(speechGroup.callout?.outlineNodeId).toBeUndefined();
    expect(speech.nodes[burstOutlineId!]).toBeUndefined();
    const body = speech.nodes[created.bodyId];
    if (body?.kind !== 'shape') throw new Error('no body');
    expect(body.strokes?.length).toBeGreaterThan(0);
    expect(speechGroup.children).toEqual([
      created.bodyId,
      ...(speechGroup.callout?.tailNodeIds ?? []),
      created.textId,
    ]);
  });

  it('clone remaps the outline reference into the duplicate', () => {
    const created = createCallout(createDocument('clone-burst', true), {
      kind: 'burst',
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      text: 'ZAP',
    });
    const group = created.document.nodes[created.groupId] as GroupNode;
    const outlineId = group.callout?.outlineNodeId;
    expect(outlineId).toBeDefined();
    const result = deepCloneSubtree(
      created.document.nodes,
      created.document.nextId,
      created.groupId,
    );
    const cloned = result.nodes[result.rootId] as GroupNode;
    expect(cloned.callout?.outlineNodeId).toBe(result.idMap.get(outlineId!));
    expect(result.nodes[cloned.callout!.outlineNodeId!]).toBeDefined();
  });
});
