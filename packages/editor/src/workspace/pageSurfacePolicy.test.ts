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
});
