// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { createDocument, makePathNode } from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context', () => ({
  useEditor: vi.fn(),
}));

import { useEditor } from '../../../context';
import { AdjustmentsPanel } from './AdjustmentsPanel';

describe('AdjustmentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the complete editable treatment surface for vector selections', () => {
    const path = makePathNode('vector-path', {
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 120, y: 0, handleIn: null, handleOut: null },
        { x: 60, y: 100, handleIn: null, handleOut: null },
      ],
      closed: true,
    });
    const baseDocument = createDocument('Effect Studio adjustments');
    vi.mocked(useEditor).mockReturnValue({
      selectedNodes: () => [path],
      openCafDialog: vi.fn(),
      state: {
        document: {
          ...baseDocument,
          rootChildren: [path.id],
          nodes: { ...baseDocument.nodes, [path.id]: path },
        },
        sectionVisibility: {},
      },
      updateNode: vi.fn(),
      updateNodes: vi.fn(),
      updateDoc: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      addSmartFilterToSelected: vi.fn(),
      announce: vi.fn(),
      createAdjustmentLayer: vi.fn(),
      toggleSectionCollapse: vi.fn(),
      toggleSubSectionCollapse: vi.fn(),
      hideInspectorSection: vi.fn(),
    } as unknown as ReturnType<typeof useEditor>);

    render(<AdjustmentsPanel />);

    expect(screen.queryByText('Image Tuning is raster-only')).not.toBeInTheDocument();
    expect(screen.getByText('Curated editable treatments')).toBeInTheDocument();
    expect(screen.getByText('Object Filters')).toBeInTheDocument();
    expect(screen.getByText('Layer Effects')).toBeInTheDocument();
  });
});
