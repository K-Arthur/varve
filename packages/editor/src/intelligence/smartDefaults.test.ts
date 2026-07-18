/** @vitest-environment jsdom */

import type { Document, NodeId } from '@strata/scene';
import { addNode, createDocument, makeFrameNode, makeTextNode } from '@strata/scene';
import { translate } from '@strata/shared';
import { describe, expect, it, vi } from 'vitest';
import { ActionTracker } from './actionTracker';
import { getSmartDefaults } from './smartDefaults';

function makeText(doc: Document, fontSize: number, fontFamily?: string) {
  const id = `txt_${Math.random().toString(36).slice(2, 8)}` as NodeId;
  return addNode(
    doc,
    makeTextNode(id, 'Hello', {
      fontSize,
      fontFamily: fontFamily ?? 'Inter',
      transform: translate(0, 0),
    }),
  );
}

function makeFrame(doc: Document, w: number, h: number, gap?: number) {
  const id = `f_${Math.random().toString(36).slice(2, 8)}` as NodeId;
  return addNode(
    doc,
    makeFrameNode(id, {
      w,
      h,
      transform: translate(0, 0),
      layoutStyle:
        gap != null
          ? {
              mode: 'flex',
              direction: 'row',
              gap,
              wrap: false,
              padding: [0, 0, 0, 0],
              grow: 0,
              shrink: 0,
            }
          : undefined,
    }),
  );
}

describe('getSmartDefaults', () => {
  it('returns sensible defaults for empty document without tracker', () => {
    const doc = createDocument('empty');
    const defaults = getSmartDefaults(doc);
    expect(defaults.frameSize).toEqual({ w: 1440, h: 900 });
    expect(defaults.fontSize).toBe(16);
    expect(defaults.spacingUnit).toBe(8);
  });

  it('uses most-used font size from text nodes', () => {
    let doc = createDocument('font-test');
    doc = makeText(doc, 16);
    doc = makeText(doc, 16);
    doc = makeText(doc, 24);
    const defaults = getSmartDefaults(doc);
    expect(defaults.fontSize).toBe(16);
  });

  it('defaults to 16 when no text nodes exist', () => {
    const doc = createDocument('no-text');
    const defaults = getSmartDefaults(doc);
    expect(defaults.fontSize).toBe(16);
  });

  it('uses most-used spacing from frame gaps', () => {
    let doc = createDocument('spacing-test');
    doc = makeFrame(doc, 100, 100, 12);
    doc = makeFrame(doc, 100, 100, 12);
    doc = makeFrame(doc, 100, 100, 8);
    const defaults = getSmartDefaults(doc);
    expect(defaults.spacingUnit).toBe(12);
  });

  it('defaults to 8 when no frames with layout gaps exist', () => {
    let doc = createDocument('no-gaps');
    doc = makeFrame(doc, 100, 100);
    doc = makeFrame(doc, 100, 100);
    const defaults = getSmartDefaults(doc);
    expect(defaults.spacingUnit).toBe(8);
  });

  it('returns deterministic defaults for same document', () => {
    let doc = createDocument('deterministic');
    doc = makeText(doc, 16);
    doc = makeFrame(doc, 100, 100, 8);
    const a = getSmartDefaults(doc);
    const b = getSmartDefaults(doc);
    expect(a).toEqual(b);
  });

  it('uses most-used frame sizes from tracker when available', () => {
    const base = Date.now();
    let now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const tracker = new ActionTracker();
    tracker.record('createFrame', { w: '375', h: '812' });
    now += 1000;
    tracker.record('createFrame', { w: '375', h: '812' });
    now += 1000;
    tracker.record('createFrame', { w: '1440', h: '900' });

    const doc = createDocument('tracker-test');
    const defaults = getSmartDefaults(doc, tracker);
    expect(defaults.frameSize).toEqual({ w: 375, h: 812 });

    vi.restoreAllMocks();
  });

  it('falls back to document defaults when tracker has no frame data', () => {
    const base = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => base);
    const tracker = new ActionTracker();
    tracker.record('tool:select');

    const doc = createDocument('empty');
    const defaults = getSmartDefaults(doc, tracker);
    expect(defaults.frameSize).toEqual({ w: 1440, h: 900 });

    vi.restoreAllMocks();
  });

  it('returns all three fields', () => {
    const doc = createDocument('fields-test');
    const defaults = getSmartDefaults(doc);
    expect(defaults).toHaveProperty('frameSize');
    expect(defaults).toHaveProperty('fontSize');
    expect(defaults).toHaveProperty('spacingUnit');
  });
});
