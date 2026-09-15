// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { createDocument, setDocumentPageLayout } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { PageLayoutOverlay } from './PageLayoutOverlay';

describe('PageLayoutOverlay', () => {
  it('renders page-scoped margins and columns only in the Page tool', () => {
    let doc = createDocument('Print');
    doc = setDocumentPageLayout(doc, {
      margins: { top: 20, bottom: 20, inside: 30, outside: 30 },
      columns: { count: 2, gutter: 16 },
    });
    const pageId = doc.pages?.[0]?.id ?? null;
    const { container, rerender } = render(
      <PageLayoutOverlay
        document={doc}
        activePageId={pageId}
        tool="page"
        zoom={1}
        worldToCanvas={(x, y) => ({ x, y })}
      />,
    );
    expect(container.querySelector('.page-layout-overlay')).toBeTruthy();
    expect(container.querySelectorAll('.page-layout-overlay__column')).toHaveLength(2);
    expect(
      container.querySelector('.page-layout-overlay__usable')?.getAttribute('points'),
    ).toContain('30,20');

    rerender(
      <PageLayoutOverlay
        document={doc}
        activePageId={pageId}
        tool="select"
        zoom={1}
        worldToCanvas={(x, y) => ({ x, y })}
      />,
    );
    expect(container.querySelector('.page-layout-overlay')).toBeNull();
  });
});
