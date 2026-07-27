import type { Document, DocumentGrid } from '@strata/scene';

export const DEFAULT_DOCUMENT_GRID_ID = 'grid-document-default';

export function getDocumentGridFromDoc(doc: Document): DocumentGrid | undefined {
  return doc.gridSettings?.documentGrid;
}

export function getOrCreateDocumentGrid(doc: Document): DocumentGrid {
  return (
    doc.gridSettings?.documentGrid ?? {
      id: DEFAULT_DOCUMENT_GRID_ID,
      type: 'document',
      name: 'Document Grid',
      visible: false,
      snapEnabled: true,
      color: 'var(--color-border-subtle)',
      opacity: 0.4,
      scope: 'document',
      spacingX: 8,
      spacingY: 8,
      subdivisions: 4,
      offsetX: 0,
      offsetY: 0,
    }
  );
}

export function documentGridWithOverrides(
  grid: DocumentGrid,
  overrides: Partial<DocumentGrid>,
): DocumentGrid {
  return { ...grid, ...overrides };
}
