import { BLANK_DOCUMENT_PRESET, findBuiltinPreset } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  bitDepthToEngine,
  createNewDocument,
  MAX_FRAME_DIMENSION,
  validateCustomFrame,
} from './newDocument';
import { CURRENT_DOCUMENT_VERSION } from './version';

const IG_POST = findBuiltinPreset('ig-post')!;
const A4 = findBuiltinPreset('a4')!;
const BUSINESS_CARD = findBuiltinPreset('business-card-us')!;

describe('createNewDocument — empty mode', () => {
  it('creates an untitled infinite-canvas document with no frame', () => {
    const res = createNewDocument({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { document } = res.result;
    expect(document.name).toBe('Untitled');
    // Flat, page-less document: no default page geometry.
    expect(document.pages).toBeUndefined();
    expect(document.rootChildren).toHaveLength(0);
    expect(document.formatVersion).toBeDefined();
  });

  it('honors the requested document name', () => {
    const res = createNewDocument({ documentName: '  Brand Refresh  ' });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.document.name).toBe('Brand Refresh');
  });

  it('keeps schema version current', () => {
    const res = createNewDocument({});
    if (!res.ok) throw new Error(res.error);
    expect(res.result.document.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });
});

describe('createNewDocument — framePreset mode', () => {
  it('inserts exactly one initial frame with preset dimensions', () => {
    const res = createNewDocument({ startMode: 'framePreset', preset: IG_POST });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { document, initialFrameId } = res.result;
    expect(initialFrameId).toBeDefined();
    expect(document.rootChildren).toHaveLength(1);
    const frame = document.nodes[initialFrameId!];
    expect(frame?.kind).toBe('frame');
    if (frame?.kind !== 'frame') return;
    // Preset px dims land 1:1 in the fixed-96dpi world unit.
    expect(frame.w).toBe(1080);
    expect(frame.h).toBe(1080);
    expect(frame.name).toBe('Instagram Post');
  });

  it('converts physical-unit presets to world px', () => {
    const res = createNewDocument({ startMode: 'framePreset', preset: A4 });
    if (!res.ok) throw new Error(res.error);
    const frame = res.result.document.nodes[res.result.initialFrameId!];
    if (frame?.kind !== 'frame') throw new Error('no frame');
    expect(frame.w).toBeCloseTo((210 / 25.4) * 96, 1);
    expect(frame.h).toBeCloseTo((297 / 25.4) * 96, 1);
  });

  it('never resizes the document for a preset', () => {
    const res = createNewDocument({ startMode: 'framePreset', preset: IG_POST });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.document.pages).toBeUndefined();
    expect(res.result.document.physicalWidth).toBeUndefined();
  });

  it('keeps the blank preset a plain empty document', () => {
    const res = createNewDocument({ startMode: 'framePreset', preset: BLANK_DOCUMENT_PRESET });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.initialFrameId).toBeUndefined();
    expect(res.result.document.rootChildren).toHaveLength(0);
  });
});

describe('createNewDocument — customFrame mode', () => {
  it('creates a frame with the custom dimensions', () => {
    const res = createNewDocument({
      startMode: 'customFrame',
      customFrame: { width: 800, height: 600, unit: 'px' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const frame = res.result.document.nodes[res.result.initialFrameId!];
    if (frame?.kind !== 'frame') throw new Error('no frame');
    expect(frame.w).toBe(800);
    expect(frame.h).toBe(600);
  });

  it('rejects invalid custom frames with a typed error', () => {
    for (const bad of [
      { width: 0, height: 100, unit: 'px' as const },
      { width: -5, height: 100, unit: 'px' as const },
      { width: Number.NaN, height: 100, unit: 'px' as const },
      { width: Number.POSITIVE_INFINITY, height: 100, unit: 'px' as const },
      { width: 1, height: 100_001, unit: 'px' as const },
    ]) {
      const res = createNewDocument({ startMode: 'customFrame', customFrame: bad });
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.error.length).toBeGreaterThan(0);
    }
  });
});

describe('createNewDocument — template mode', () => {
  it('decodes a template through the versioned pipeline', () => {
    const source = createNewDocument({
      documentName: 'Template',
      startMode: 'framePreset',
      preset: IG_POST,
    });
    if (!source.ok) throw new Error(source.error);
    const json = JSON.stringify(source.result.document);
    const res = createNewDocument({
      startMode: 'template',
      templateJson: json,
      documentName: 'From template',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.document.name).toBe('From template');
    expect(res.result.document.rootChildren).toHaveLength(1);
  });

  it('fails atomically on malformed template payloads', () => {
    const res = createNewDocument({ startMode: 'template', templateJson: '{not json' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.length).toBeGreaterThan(0);
  });

  it('fails when template payload is missing', () => {
    const res = createNewDocument({ startMode: 'template' });
    expect(res.ok).toBe(false);
  });
});

describe('createNewDocument — advanced settings', () => {
  it('maps color mode and bit depth to document colorConfig', () => {
    const res = createNewDocument({
      startMode: 'framePreset',
      preset: IG_POST,
      colorMode: 'cmyk',
      bitDepth: 16,
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.document.colorConfig?.mode).toBe('cmyk');
    expect(res.result.document.colorConfig?.bitDepth).toBe('uint16');
  });

  it('maps print preset bleed and dpi to document-level metadata', () => {
    const res = createNewDocument({ startMode: 'framePreset', preset: BUSINESS_CARD });
    if (!res.ok) throw new Error(res.error);
    const { document } = res.result;
    expect(document.bleed).toEqual({
      top: 3,
      right: 3,
      bottom: 3,
      left: 3,
      unit: 'mm',
      linked: true,
    });
    expect(document.dpi).toBe(300);
    expect(document.colorConfig?.mode).toBe('cmyk');
  });

  it('resolves a color profile id when present', () => {
    const res = createNewDocument({
      startMode: 'framePreset',
      preset: IG_POST,
      colorProfileId: 'srgb',
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.result.document.colorConfig?.rgbProfile?.id).toBe('srgb');
  });
});

describe('validateCustomFrame', () => {
  it('enforces the engine ceiling', () => {
    expect(validateCustomFrame({ width: 10, height: 10, unit: 'px' })).toBeNull();
    expect(validateCustomFrame({ width: MAX_FRAME_DIMENSION, height: 10, unit: 'px' })).toBeNull();
    expect(validateCustomFrame({ width: MAX_FRAME_DIMENSION + 1, height: 10, unit: 'px' })).toMatch(
      /too large/,
    );
    // mm at 96dpi exceeds the ceiling faster than px.
    expect(validateCustomFrame({ width: 30_000, height: 10, unit: 'mm' })).toMatch(/too large/);
  });
});

describe('bitDepthToEngine', () => {
  it('maps 8/16/32 to engine bit depths', () => {
    expect(bitDepthToEngine(8)).toBe('uint8');
    expect(bitDepthToEngine(16)).toBe('uint16');
    expect(bitDepthToEngine(32)).toBe('float32');
    expect(bitDepthToEngine(undefined)).toBe('uint8');
  });
});
