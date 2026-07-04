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
    expect(bleedIssue!.severity).toBe('error');
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
