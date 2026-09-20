import { describe, expect, it } from 'vitest';
import { resolvePageSurfaceVisibility } from './useWorkspaceConfig';

describe('resolvePageSurfaceVisibility', () => {
  it('keeps publishing pages out of the Design workspace', () => {
    expect(
      resolvePageSurfaceVisibility({ mode: 'design', pageCount: 2, pagePanelVisible: false }),
    ).toEqual({
      renderPageSurfaces: false,
      showPagesPanel: false,
      showPageNavigation: false,
      showPrintGeometry: false,
    });
  });

  it('exposes Design Canvas management in Design without adding publishing chrome', () => {
    expect(
      resolvePageSurfaceVisibility({ mode: 'design', pageCount: 2, pagePanelVisible: true }),
    ).toEqual({
      renderPageSurfaces: false,
      showPagesPanel: true,
      showPageNavigation: false,
      showPrintGeometry: false,
    });
  });

  it('keeps Design Canvas management available when no publishing page exists', () => {
    expect(
      resolvePageSurfaceVisibility({ mode: 'design', pageCount: 0, pagePanelVisible: true }),
    ).toEqual({
      renderPageSurfaces: false,
      showPagesPanel: true,
      showPageNavigation: false,
      showPrintGeometry: false,
    });
  });

  it('offers page management for an empty Print document', () => {
    expect(
      resolvePageSurfaceVisibility({ mode: 'print', pageCount: 0, pagePanelVisible: true }),
    ).toMatchObject({
      renderPageSurfaces: false,
      showPagesPanel: true,
      showPageNavigation: false,
      showPrintGeometry: false,
    });
  });

  it('reserves publishing-page chrome for Print workspace', () => {
    expect(
      resolvePageSurfaceVisibility({ mode: 'image', pageCount: 1, pagePanelVisible: true }),
    ).toEqual({
      renderPageSurfaces: false,
      showPagesPanel: false,
      showPageNavigation: false,
      showPrintGeometry: false,
    });
  });

  it('discloses publishing pages in Draw for a comic profile', () => {
    expect(
      resolvePageSurfaceVisibility({
        mode: 'drawing',
        pageCount: 3,
        pagePanelVisible: true,
        workflowProfile: 'manga',
      }),
    ).toEqual({
      renderPageSurfaces: true,
      showPagesPanel: true,
      showPageNavigation: true,
      showPrintGeometry: false,
    });
  });

  it("reveals a comic Draw document's pages through the Draw default", () => {
    // Draw's built-in layout hides the Page Navigator. An untouched default
    // must not make a profiled document's own pages undiscoverable.
    expect(
      resolvePageSurfaceVisibility({
        mode: 'drawing',
        pageCount: 3,
        pagePanelVisible: false,
        workflowProfile: 'comic-print',
        pagePanelUserControlled: false,
      }),
    ).toMatchObject({
      showPagesPanel: true,
      showPageNavigation: true,
      renderPageSurfaces: true,
    });
  });

  it('honors an explicit user hide of the Page Navigator in comic Draw', () => {
    expect(
      resolvePageSurfaceVisibility({
        mode: 'drawing',
        pageCount: 3,
        pagePanelVisible: false,
        workflowProfile: 'comic-print',
        pagePanelUserControlled: true,
      }),
    ).toMatchObject({
      showPagesPanel: false,
      showPageNavigation: false,
      renderPageSurfaces: true,
    });
  });

  it('keeps ordinary Draw documents free of publishing chrome', () => {
    expect(
      resolvePageSurfaceVisibility({
        mode: 'drawing',
        pageCount: 3,
        pagePanelVisible: false,
        pagePanelUserControlled: false,
      }),
    ).toEqual({
      renderPageSurfaces: false,
      showPagesPanel: false,
      showPageNavigation: false,
      showPrintGeometry: false,
    });
  });
});
