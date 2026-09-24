import { describe, expect, it } from 'vitest';
import { assignMasterToPage, createDocument, createMaster } from './document';
import {
  clearMasterPageLayout,
  clearPageLayout,
  DEFAULT_PAGE_LAYOUT,
  resolvePageLayout,
  setDocumentPageLayout,
  setMasterPageLayout,
  setPageLayout,
  validatePageLayoutSettings,
} from './pageLayout';
import type { PageLayoutSettings } from './types';

const layout = (
  overrides: {
    margins?: Partial<PageLayoutSettings['margins']>;
    columns?: Partial<PageLayoutSettings['columns']>;
  } = {},
): PageLayoutSettings => ({
  ...DEFAULT_PAGE_LAYOUT,
  ...overrides,
  margins: { ...DEFAULT_PAGE_LAYOUT.margins, ...(overrides.margins ?? {}) },
  columns: { ...DEFAULT_PAGE_LAYOUT.columns, ...(overrides.columns ?? {}) },
});

describe('page layout', () => {
  it('resolves document defaults into non-mutating usable geometry', () => {
    const doc = setDocumentPageLayout(
      createDocument('Print'),
      layout({
        margins: { top: 40, bottom: 60, inside: 24, outside: 36 },
        columns: { count: 3, gutter: 12 },
      }),
    );
    const page = doc.pages?.[0];
    if (!page) throw new Error('expected default page');

    const resolved = resolvePageLayout(doc, page.id);
    expect(resolved?.margins).toEqual({ top: 40, bottom: 60, left: 24, right: 36 });
    expect(resolved?.usableBounds).toEqual({
      x: 24,
      y: 40,
      width: page.width - 60,
      height: page.height - 100,
    });
    expect(resolved?.columns).toHaveLength(3);
    expect(resolved?.columns[0]?.width).toBeCloseTo((page.width - 60 - 24) / 3);
    expect(doc.pages?.[0]?.layout).toBeUndefined();
  });

  it('uses page overrides before master and document defaults', () => {
    let doc = createDocument('Print');
    const page = doc.pages?.[0];
    if (!page) throw new Error('expected default page');
    doc = setDocumentPageLayout(doc, layout({ margins: { inside: 10 } }));
    doc = createMaster(doc, { name: 'Editorial', width: page.width, height: page.height });
    const masterId = Object.keys(doc.masters ?? {})[0];
    if (!masterId) throw new Error('expected master');
    const master = doc.masters?.[masterId];
    if (!master) throw new Error('expected master record');
    doc = {
      ...doc,
      masters: {
        ...doc.masters,
        [masterId]: { ...master, layout: layout({ margins: { inside: 20 } }) },
      },
    };
    doc = assignMasterToPage(doc, page.id, masterId);
    expect(resolvePageLayout(doc, page.id)?.settings.margins.inside).toBe(20);
    doc = setPageLayout(doc, page.id, layout({ margins: { inside: 30 } }));
    expect(resolvePageLayout(doc, page.id)?.settings.margins.inside).toBe(30);
    doc = clearPageLayout(doc, page.id);
    expect(resolvePageLayout(doc, page.id)?.settings.margins.inside).toBe(20);
  });

  it('maps inside and outside to the binding edge for facing pages', () => {
    let doc = createDocument('Book');
    const first = doc.pages?.[0];
    if (!first) throw new Error('expected first page');
    doc = {
      ...doc,
      pages: [
        first,
        {
          ...first,
          id: 'page-2',
          name: 'Page 2',
          contentRoot: `${first.contentRoot}-2`,
          order: 'a1',
        },
      ],
      facingPages: { enabled: true, startOnRight: true },
      spreads: [
        { id: 'spread-0', pageIds: [first.id] },
        { id: 'spread-1', pageIds: ['page-2', first.id] },
      ],
    };
    doc = setDocumentPageLayout(doc, layout({ margins: { inside: 10, outside: 20 } }));
    expect(resolvePageLayout(doc, first.id)?.pageSide).toBe('right');
    expect(resolvePageLayout(doc, first.id)?.margins.left).toBe(10);
  });

  it('reports invalid values and geometry that cannot fit', () => {
    expect(
      validatePageLayoutSettings({
        margins: { top: -1, bottom: 0, inside: 0, outside: 0 },
        columns: { count: 0, gutter: 0 },
      }),
    ).toHaveLength(2);

    const doc = setDocumentPageLayout(
      createDocument('Small'),
      layout({ margins: { top: 600, bottom: 600 }, columns: { count: 3, gutter: 1000 } }),
    );
    const page = doc.pages?.[0];
    if (!page) throw new Error('expected default page');
    const resolved = resolvePageLayout(doc, page.id);
    expect(resolved?.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['margins-exceed-page', 'columns-exceed-usable-width']),
    );
    expect(resolved?.usableBounds.width).toBe(1920);
  });

  it('keeps row and column gutters independent and reports the source', () => {
    const doc = setDocumentPageLayout(createDocument('Rows and columns'), {
      margins: { top: 20, bottom: 20, inside: 30, outside: 30 },
      columns: { count: 3, gutter: 12 },
      rows: { count: 2, gutter: 28 },
      display: true,
      snapEnabled: true,
    });
    const page = doc.pages?.[0];
    if (!page) throw new Error('expected default page');
    const resolved = resolvePageLayout(doc, page.id);
    expect(resolved?.source).toBe('document-default');
    expect(resolved?.columns).toHaveLength(3);
    expect(resolved?.rows).toHaveLength(2);
    expect(resolved?.sharedSegments).toHaveLength(10);
  });

  it('labels invalid settings as the built-in fallback', () => {
    // Model a legacy/corrupt document payload that bypassed the setter.
    const invalidDoc = {
      ...createDocument('Invalid rows'),
      pageLayout: {
        ...DEFAULT_PAGE_LAYOUT,
        margins: { top: -1, bottom: 0, inside: 0, outside: 0 },
      },
    };
    const page = invalidDoc.pages?.[0];
    if (!page) throw new Error('expected default page');
    const resolved = resolvePageLayout(invalidDoc, page.id);
    expect(resolved?.source).toBe('built-in-default');
  });

  it('reports row gutter overflow separately from column overflow', () => {
    const doc = setDocumentPageLayout(createDocument('Row overflow'), {
      ...DEFAULT_PAGE_LAYOUT,
      margins: { top: 500, bottom: 500, inside: 0, outside: 0 },
      rows: { count: 3, gutter: 100 },
    });
    const page = doc.pages?.[0];
    if (!page) throw new Error('expected default page');
    const resolved = resolvePageLayout(doc, page.id);
    expect(resolved?.issues.map((issue) => issue.code)).toContain('rows-exceed-usable-height');
    expect(resolved?.issues.map((issue) => issue.code)).not.toContain(
      'columns-exceed-usable-width',
    );
  });

  it('sets and clears master layouts without mutating the input document', () => {
    let doc = createDocument('Master layout');
    const page = doc.pages?.[0];
    if (!page) throw new Error('expected default page');
    doc = createMaster(doc, { name: 'Grid', width: page.width, height: page.height });
    const masterId = Object.keys(doc.masters ?? {})[0];
    if (!masterId) throw new Error('expected master');
    const original = doc;
    const withLayout = setMasterPageLayout(doc, masterId, {
      ...DEFAULT_PAGE_LAYOUT,
      rows: { count: 4, gutter: 16 },
    });
    expect(withLayout).not.toBe(original);
    expect(doc.masters?.[masterId]?.layout).toBeUndefined();
    expect(withLayout.masters?.[masterId]?.layout?.rows).toEqual({ count: 4, gutter: 16 });
    expect(clearMasterPageLayout(withLayout, masterId).masters?.[masterId]?.layout).toBeUndefined();
  });
});
