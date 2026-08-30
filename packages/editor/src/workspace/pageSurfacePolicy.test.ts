import { describe, expect, it } from 'vitest';
import { resolvePageSurfaceVisibility } from './useWorkspaceConfig';

describe('resolvePageSurfaceVisibility', () => {
  it('keeps page rendering independent from management-panel disclosure', () => {
    expect(
      resolvePageSurfaceVisibility({ mode: 'design', pageCount: 2, pagePanelVisible: false }),
    ).toEqual({
      renderPageSurfaces: true,
      showPagesPanel: false,
      showPageNavigation: false,
      showPrintGeometry: false,
    });
  });

  it('exposes the same publishing-page controls in Design without adding print chrome', () => {
    expect(
      resolvePageSurfaceVisibility({ mode: 'design', pageCount: 2, pagePanelVisible: true }),
    ).toEqual({
      renderPageSurfaces: true,
      showPagesPanel: true,
      showPageNavigation: true,
      showPrintGeometry: false,
    });
  });

  it('keeps the ordinary design canvas available when no publishing page exists', () => {
    expect(
      resolvePageSurfaceVisibility({ mode: 'design', pageCount: 0, pagePanelVisible: true }),
    ).toEqual({
      renderPageSurfaces: false,
      showPagesPanel: false,
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

  it('does not create print controls for other workspaces', () => {
    expect(
      resolvePageSurfaceVisibility({ mode: 'image', pageCount: 1, pagePanelVisible: true }),
    ).toEqual({
      renderPageSurfaces: true,
      showPagesPanel: true,
      showPageNavigation: true,
      showPrintGeometry: false,
    });
  });
});
