/**
 * PagePrintOverlays (M12, ADR-0166): per-page print geometry previews on
 * the shared canvas — bleed, slug and safe area resolve through
 * resolvePagePrintGeometry (document defaults + page overrides) and render
 * at each page's placed position. Mounted while bleed guides are visible.
 */

import type { Document } from '@varve/scene';
import { resolvePagePlacement, resolvePagePrintGeometry } from '@varve/scene';
import { memo, useMemo } from 'react';
import { PrintOverlays } from './PrintOverlays/PrintOverlays';

export interface PagePrintOverlaysProps {
  document: Document;
  zoom: number;
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
}

export const PagePrintOverlays = memo(function PagePrintOverlays({
  document,
  zoom,
  worldToCanvas,
}: PagePrintOverlaysProps): React.ReactNode {
  const pages = useMemo(() => {
    const out: Array<{
      key: string;
      width: number;
      height: number;
      origin: { x: number; y: number };
      bleed: ReturnType<typeof resolvePagePrintGeometry>['bleed'];
      safeArea: ReturnType<typeof resolvePagePrintGeometry>['safeArea'];
      slug: ReturnType<typeof resolvePagePrintGeometry>['slug'];
    }> = [];
    for (const page of document.pages ?? []) {
      const placement = resolvePagePlacement(document, page.id);
      if (!placement) continue;
      const geometry = resolvePagePrintGeometry(document, page.id);
      const origin = worldToCanvas(placement.x, placement.y);
      out.push({
        key: page.id,
        width: page.width,
        height: page.height,
        origin,
        bleed: geometry.bleed,
        safeArea: geometry.safeArea,
        slug: geometry.slug,
      });
    }
    return out;
  }, [document, worldToCanvas]);

  if (pages.length === 0) return null;

  return (
    <>
      {pages.map((page) => (
        <PrintOverlays
          key={page.key}
          pageWidth={page.width}
          pageHeight={page.height}
          zoom={zoom}
          documentUnit="px"
          dpi={96}
          bleed={page.bleed}
          safeArea={page.safeArea}
          slug={page.slug}
          pxPerUnit={1}
          offsetX={page.origin.x}
          offsetY={page.origin.y}
        />
      ))}
    </>
  );
});
