import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLEED,
  defaultCmykColorConfig,
  defaultRgbColorConfig,
  uniformBleed,
} from './colorManagement';
import type { Document } from './document';
import { createDocument } from './document';
import {
  DEFAULT_PREFLIGHT_OPTIONS,
  getPreflightErrors,
  isPrintReady,
  runPrintPreflight,
} from './printPreflight';

function makePrintDoc(overrides: Partial<Document> = {}): Document {
  return {
    ...createDocument('print-test'),
    colorConfig: defaultCmykColorConfig(),
    documentUnit: 'mm',
    physicalWidth: 210,
    physicalHeight: 297,
    dpi: 300,
    bleed: { ...DEFAULT_BLEED },
    ...overrides,
  };
}

describe('runPrintPreflight', () => {
  it('returns ready=true for a properly configured CMYK document', () => {
    const doc = makePrintDoc();
    const result = runPrintPreflight(doc);
    expect(result.ready).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('returns ready=true for a minimal document with no print config', () => {
    const doc = createDocument('blank');
    const result = runPrintPreflight(doc, { checkProfiles: false, minBleedMm: undefined });
    expect(result.ready).toBe(true);
  });

  it('reports error when bleed is missing and minBleedMm is required', () => {
    const doc = makePrintDoc({ bleed: undefined });
    const result = runPrintPreflight(doc, { minBleedMm: 3 });
    expect(result.errorCount).toBeGreaterThan(0);
    const bleedIssue = result.issues.find((i) => i.category === 'bleed');
    expect(bleedIssue).toBeDefined();
    expect(bleedIssue?.severity).toBe('error');
    expect(result.ready).toBe(false);
  });

  it('reports warning when bleed is less than recommended', () => {
    const doc = makePrintDoc({
      bleed: uniformBleed(1, 'mm'),
    });
    const result = runPrintPreflight(doc, { minBleedMm: 3 });
    expect(result.warningCount).toBeGreaterThan(0);
    const bleedIssue = result.issues.find(
      (i) => i.category === 'bleed' && i.severity === 'warning',
    );
    expect(bleedIssue).toBeDefined();
  });

  it('reports info when bleed values are non-uniform', () => {
    const doc = makePrintDoc({
      bleed: { top: 3, right: 5, bottom: 3, left: 3, linked: false, unit: 'mm' },
    });
    const result = runPrintPreflight(doc);
    const infoIssue = result.issues.find((i) => i.category === 'bleed' && i.severity === 'info');
    expect(infoIssue).toBeDefined();
  });

  it('reports error when color mode mismatch', () => {
    const doc = makePrintDoc({
      colorConfig: defaultRgbColorConfig(),
    });
    const result = runPrintPreflight(doc, { requiredColorMode: 'cmyk' });
    const colorIssue = result.issues.find(
      (i) => i.category === 'color-space' && i.severity === 'error',
    );
    expect(colorIssue).toBeDefined();
    expect(result.ready).toBe(false);
  });

  it('reports warning when color mode is not set', () => {
    const doc = makePrintDoc({ colorConfig: undefined });
    const result = runPrintPreflight(doc, { requiredColorMode: 'cmyk' });
    const colorIssue = result.issues.find(
      (i) => i.category === 'color-space' && i.severity === 'warning',
    );
    expect(colorIssue).toBeDefined();
  });

  it('reports error when CMYK document has no output intent', () => {
    const cfg = defaultCmykColorConfig();
    cfg.outputIntent = undefined;
    const doc = makePrintDoc({ colorConfig: cfg });
    const result = runPrintPreflight(doc, { checkProfiles: true });
    const profileIssue = result.issues.find(
      (i) => i.category === 'profile' && i.severity === 'error',
    );
    expect(profileIssue).toBeDefined();
  });

  it('reports warning when DPI is below minimum', () => {
    const doc = makePrintDoc({ dpi: 150 });
    const result = runPrintPreflight(doc, { minDpi: 300 });
    const dpiIssue = result.issues.find(
      (i) => i.category === 'resolution' && i.severity === 'warning',
    );
    expect(dpiIssue).toBeDefined();
  });

  it('reports warning when page is oversized', () => {
    const doc = makePrintDoc({
      physicalWidth: 500,
      physicalHeight: 700,
    });
    const result = runPrintPreflight(doc, {
      maxPageMm: { width: 300, height: 400 },
    });
    const oversizeIssue = result.issues.find((i) => i.category === 'oversize');
    expect(oversizeIssue).toBeDefined();
  });

  it('does not report oversize when within limits', () => {
    const doc = makePrintDoc();
    const result = runPrintPreflight(doc, {
      maxPageMm: { width: 300, height: 400 },
    });
    const oversizeIssue = result.issues.find((i) => i.category === 'oversize');
    expect(oversizeIssue).toBeUndefined();
  });

  it('reports font error when text node uses missing font', () => {
    const doc = makePrintDoc({
      nodes: {
        t1: {
          id: 't1',
          kind: 'text',
          name: 'Missing Font Text',
          fontFamily: 'NonExistentFont',
          fontSize: 12,
          text: 'Hello',
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal' as const,
          rotation: 0,
          transform: [1, 0, 0, 1, 0, 0] as const,
        } as import('./types').TextNode,
      },
    });
    const result = runPrintPreflight(doc, {
      checkFonts: true,
      availableFonts: new Set(['Inter', 'Arial']),
    });
    const fontIssue = result.issues.find((i) => i.category === 'font' && i.severity === 'error');
    expect(fontIssue).toBeDefined();
    expect(fontIssue?.message).toContain('NonExistentFont');
    expect(result.ready).toBe(false);
  });

  it('reports no font error when all fonts are available', () => {
    const doc = makePrintDoc({
      nodes: {
        t1: {
          id: 't1',
          kind: 'text',
          name: 'Available Font Text',
          fontFamily: 'Inter',
          fontSize: 12,
          text: 'Hello',
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal' as const,
          rotation: 0,
          transform: [1, 0, 0, 1, 0, 0] as const,
        } as import('./types').TextNode,
      },
    });
    const result = runPrintPreflight(doc, {
      checkFonts: true,
      availableFonts: new Set(['Inter', 'Arial']),
    });
    const fontIssue = result.issues.find((i) => i.category === 'font');
    expect(fontIssue).toBeUndefined();
  });

  it('reports font error for rich text run with missing font', () => {
    const doc = makePrintDoc({
      nodes: {
        t1: {
          id: 't1',
          kind: 'text',
          name: 'Rich Missing Font',
          fontFamily: 'Inter',
          fontSize: 12,
          text: 'Hello',
          richText: {
            paragraphs: [
              {
                runs: [{ text: 'Hello', format: { fontFamily: 'MissingFont' } }],
              },
            ],
          },
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal' as const,
          rotation: 0,
          transform: [1, 0, 0, 1, 0, 0] as const,
        } as import('./types').TextNode,
      },
    });
    const result = runPrintPreflight(doc, {
      checkFonts: true,
      availableFonts: new Set(['Inter']),
    });
    const fontIssue = result.issues.find((i) => i.category === 'font' && i.severity === 'error');
    expect(fontIssue).toBeDefined();
    expect(fontIssue?.message).toContain('MissingFont');
  });

  it('reports low effective DPI for an image stretched well beyond its native resolution', () => {
    const doc = makePrintDoc({
      nodes: {
        img1: {
          id: 'img1',
          kind: 'shape',
          name: 'Stretched Photo',
          layerColor: null,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal' as const,
          rotation: 0,
          shape: { kind: 'rect', x: 0, y: 0, w: 2000, h: 2000 },
          transform: [1, 0, 0, 1, 0, 0] as const,
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
          fills: [
            {
              type: 'image',
              image: {
                src: 'data:image/png;base64,x',
                fit: 'fill',
                x: 0,
                y: 0,
                scale: 1,
                imageWidth: 300,
                imageHeight: 300,
              },
              opacity: 1,
              blendMode: 'normal' as const,
              visible: true,
            },
          ],
          strokes: [],
          effects: [],
        } as import('./types').ShapeNode,
      },
    });
    const result = runPrintPreflight(doc, { minDpi: 300 });
    const dpiIssue = result.issues.find((i) => i.category === 'resolution' && i.nodeId === 'img1');
    expect(dpiIssue).toBeDefined();
    expect(dpiIssue?.severity).toBe('warning');
    expect(dpiIssue?.message).toContain('Stretched Photo');
  });

  it('does not report low effective DPI for an image at its native size or smaller', () => {
    const doc = makePrintDoc({
      nodes: {
        img1: {
          id: 'img1',
          kind: 'shape',
          name: 'Crisp Photo',
          layerColor: null,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal' as const,
          rotation: 0,
          // 300px box at 96px/in = 3.125in; 3000px native / 3.125in = 960 effective DPI.
          shape: { kind: 'rect', x: 0, y: 0, w: 300, h: 300 },
          transform: [1, 0, 0, 1, 0, 0] as const,
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
          fills: [
            {
              type: 'image',
              image: {
                src: 'data:image/png;base64,x',
                fit: 'fill',
                x: 0,
                y: 0,
                scale: 1,
                imageWidth: 3000,
                imageHeight: 3000,
              },
              opacity: 1,
              blendMode: 'normal' as const,
              visible: true,
            },
          ],
          strokes: [],
          effects: [],
        } as import('./types').ShapeNode,
      },
    });
    const result = runPrintPreflight(doc, { minDpi: 300 });
    const dpiIssue = result.issues.find((i) => i.category === 'resolution' && i.nodeId === 'img1');
    expect(dpiIssue).toBeUndefined();
  });

  it('uses correct crop-mode DPI (natural-size display, same as fit)', () => {
    // Crop mode draws the image at its native size (× scale), so DPI = 96/scale.
    // A 300px image in a 2000px box at scale=1 has 96 effective DPI, which is
    // below 300 DPI and should trigger a warning.
    const doc = makePrintDoc({
      nodes: {
        img1: {
          id: 'img1',
          kind: 'shape',
          name: 'Crop Image',
          layerColor: null,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal' as const,
          rotation: 0,
          shape: { kind: 'rect', x: 0, y: 0, w: 2000, h: 2000 },
          transform: [1, 0, 0, 1, 0, 0] as const,
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
          fills: [
            {
              type: 'image',
              image: {
                src: 'data:image/png;base64,x',
                fit: 'crop' as const,
                x: 0,
                y: 0,
                scale: 1,
                imageWidth: 300,
                imageHeight: 300,
              },
              opacity: 1,
              blendMode: 'normal' as const,
              visible: true,
            },
          ],
          strokes: [],
          effects: [],
        } as import('./types').ShapeNode,
      },
    });
    const result = runPrintPreflight(doc, { minDpi: 300 });
    const dpiIssue = result.issues.find((i) => i.category === 'resolution' && i.nodeId === 'img1');
    expect(dpiIssue).toBeDefined();
    expect(dpiIssue?.message).toContain('Crop Image');
  });

  it('does not report low DPI for crop-mode with high-res image', () => {
    // A 6000px image at scale=2 in crop mode → displayed=12000px
    // effective DPI = 6000 / (12000/96) = 48 — still below 300 in this scenario
    // So use a more realistic test: 6000px image at scale=0.5 → displayed=3000px
    // effective DPI = 6000 / (3000/96) = 192 — still below 300
    // Use a high-res image: 10000px at scale=0.25 → displayed=2500px
    // effective DPI = 10000 / (2500/96) = 384 - above 300 (pass)
    const doc = makePrintDoc({
      nodes: {
        img1: {
          id: 'img1',
          kind: 'shape',
          name: 'Crop HighRes',
          layerColor: null,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal' as const,
          rotation: 0,
          shape: { kind: 'rect', x: 0, y: 0, w: 800, h: 600 },
          transform: [1, 0, 0, 1, 0, 0] as const,
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
          fills: [
            {
              type: 'image',
              image: {
                src: 'data:image/png;base64,x',
                fit: 'crop' as const,
                x: 0,
                y: 0,
                scale: 0.25,
                imageWidth: 10000,
                imageHeight: 10000,
              },
              opacity: 1,
              blendMode: 'normal' as const,
              visible: true,
            },
          ],
          strokes: [],
          effects: [],
        } as import('./types').ShapeNode,
      },
    });
    const result = runPrintPreflight(doc, { minDpi: 300 });
    const dpiIssue = result.issues.find((i) => i.category === 'resolution' && i.nodeId === 'img1');
    expect(dpiIssue).toBeUndefined();
  });

  it('reports color-space warning for an RGB fill when CMYK output is required', () => {
    const doc = makePrintDoc({
      nodes: {
        rect1: {
          id: 'rect1',
          kind: 'shape',
          name: 'RGB Rectangle',
          layerColor: null,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal' as const,
          rotation: 0,
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          transform: [1, 0, 0, 1, 0, 0] as const,
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
          fills: [
            {
              type: 'solid',
              color: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 },
              opacity: 1,
              blendMode: 'normal' as const,
              visible: true,
            },
          ],
          strokes: [],
          effects: [],
        } as import('./types').ShapeNode,
      },
    });
    const result = runPrintPreflight(doc, { requiredColorMode: 'cmyk' });
    const colorIssue = result.issues.find(
      (i) => i.category === 'color-space' && i.nodeId === 'rect1',
    );
    expect(colorIssue).toBeDefined();
    expect(colorIssue?.severity).toBe('warning');
  });

  it('does not report node color-space warning for a CMYK fill', () => {
    const doc = makePrintDoc({
      nodes: {
        rect1: {
          id: 'rect1',
          kind: 'shape',
          name: 'CMYK Rectangle',
          layerColor: null,
          order: 'a0',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal' as const,
          rotation: 0,
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          transform: [1, 0, 0, 1, 0, 0] as const,
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
          fills: [
            {
              type: 'solid',
              color: { space: 'cmyk' as const, c: 0, m: 0, y: 0, k: 100, a: 255 },
              opacity: 1,
              blendMode: 'normal' as const,
              visible: true,
            },
          ],
          strokes: [],
          effects: [],
        } as import('./types').ShapeNode,
      },
    });
    const result = runPrintPreflight(doc, { requiredColorMode: 'cmyk' });
    const colorIssue = result.issues.find(
      (i) => i.category === 'color-space' && i.nodeId === 'rect1',
    );
    expect(colorIssue).toBeUndefined();
  });

  it('reports broken-chain error for text chain referencing missing frame', () => {
    const doc = makePrintDoc({
      textChains: {
        chain1: {
          id: 'chain1',
          name: 'Test Chain',
          frameIds: ['missing-frame'],
        },
      },
    });
    const result = runPrintPreflight(doc, {
      checkFonts: true,
    });
    const chainIssue = result.issues.find(
      (i) => i.category === 'font' && i.message.includes('missing frame'),
    );
    expect(chainIssue).toBeDefined();
  });
});

describe('isPrintReady', () => {
  it('returns true for a ready document', () => {
    const doc = makePrintDoc();
    expect(isPrintReady(doc)).toBe(true);
  });

  it('returns false when errors exist', () => {
    const doc = makePrintDoc({ bleed: undefined });
    expect(isPrintReady(doc, { minBleedMm: 3 })).toBe(false);
  });
});

describe('getPreflightErrors', () => {
  it('returns only error-level issues', () => {
    const doc = makePrintDoc({
      bleed: undefined,
      colorConfig: defaultRgbColorConfig(),
    });
    const errors = getPreflightErrors(doc, {
      minBleedMm: 3,
      requiredColorMode: 'cmyk',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.severity === 'error')).toBe(true);
  });
});

describe('DEFAULT_PREFLIGHT_OPTIONS', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_PREFLIGHT_OPTIONS.minBleedMm).toBe(3);
    expect(DEFAULT_PREFLIGHT_OPTIONS.minDpi).toBe(300);
    expect(DEFAULT_PREFLIGHT_OPTIONS.checkProfiles).toBe(true);
  });
});

describe('raster image profile findings (IMAGE_PROFILE_MISSING)', () => {
  function makeImageDoc(metadata?: import('./types').ImageSourceMetadata): Document {
    const base = makePrintDoc();
    const image = {
      src: 'data:image/png;base64,x',
      fit: 'fill' as const,
      x: 0,
      y: 0,
      scale: 1,
      imageWidth: 300,
      imageHeight: 300,
    };
    const node = {
      id: 'img-profile',
      kind: 'shape',
      name: 'Profile Photo',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      transform: [1, 0, 0, 1, 0, 0] as const,
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
      fills: [
        {
          type: 'image',
          image: metadata ? { ...image, assetId: 'asset-x' } : image,
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        },
      ],
      strokes: [],
      effects: [],
    } as unknown as import('./types').ShapeNode;
    return {
      ...base,
      nodes: { 'img-profile': node },
      ...(metadata
        ? {
            assets: {
              'asset-x': {
                id: 'asset-x',
                storage: 'embedded' as const,
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,x',
                naturalWidth: 300,
                naturalHeight: 300,
                byteLength: 1,
                hash: 'h',
                metadata,
              },
            },
          }
        : {}),
    };
  }

  it('flags an untagged legacy image with IMAGE_PROFILE_MISSING', () => {
    const doc = makeImageDoc({});
    const result = runPrintPreflight(doc, { minBleedMm: undefined });
    const finding = result.issues.find(
      (i) => i.category === 'profile' && i.nodeId === 'img-profile',
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('warning');
    expect(finding?.message).toContain('no embedded colour profile');
  });

  it('flags an image with explicit invalid ICC status', () => {
    const doc = makeImageDoc({ iccStatus: 'invalid' });
    const result = runPrintPreflight(doc, { minBleedMm: undefined });
    const finding = result.issues.find(
      (i) => i.category === 'profile' && i.nodeId === 'img-profile',
    );
    expect(finding).toBeDefined();
    expect(finding?.message).toContain('invalid embedded colour profile');
  });

  it('reports a mismatch info when the embedded profile differs from the document profile', () => {
    const doc = makeImageDoc({
      iccStatus: 'valid',
      iccProfileId: 'icc-x',
      colorEncoding: {
        model: 'rgb',
        primaries: 'display-p3',
        transfer: 'gamma22',
        provenance: 'embedded-icc',
      },
    });
    const result = runPrintPreflight(doc, { minBleedMm: undefined });
    const finding = result.issues.find(
      (i) => i.category === 'profile' && i.nodeId === 'img-profile',
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('info');
    expect(finding?.message).toContain('display-p3');
    expect(finding?.message).toContain('document works in');
  });

  it('stays silent for an sRGB-tagged image in an sRGB document', () => {
    const doc = makeImageDoc({
      iccStatus: 'valid',
      iccProfileId: 'icc-x',
      colorEncoding: {
        model: 'rgb',
        primaries: 'srgb',
        transfer: 'srgb',
        provenance: 'embedded-icc',
      },
    });
    const result = runPrintPreflight(doc, { minBleedMm: undefined });
    const finding = result.issues.find(
      (i) => i.category === 'profile' && i.nodeId === 'img-profile',
    );
    expect(finding).toBeUndefined();
  });

  it('respects checkImageProfiles: false', () => {
    const doc = makeImageDoc();
    const result = runPrintPreflight(doc, { minBleedMm: undefined, checkImageProfiles: false });
    const finding = result.issues.find(
      (i) => i.category === 'profile' && i.nodeId === 'img-profile',
    );
    expect(finding).toBeUndefined();
  });
});
