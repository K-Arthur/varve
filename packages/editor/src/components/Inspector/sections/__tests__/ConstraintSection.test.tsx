import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider } from '../../../../context';
import { ConstraintSection } from '../ConstraintSection';

afterEach(cleanup);

/** Build a full Document JSON for initialDocumentJson */
function buildDocJson(frameChildren: string[] = []) {
  const nodes: Record<string, unknown> = {
    f1: {
      id: 'f1',
      kind: 'frame',
      name: 'Frame',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      order: 'a0',
      w: 300,
      h: 200,
      fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
      strokes: [],
      effects: [],
      children: frameChildren,
      transform: [1, 0, 0, 1, 0, 0],
    },
  };
  for (const cid of frameChildren) {
    nodes[cid] = {
      id: cid,
      kind: 'shape',
      name: 'Child',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      order: 'a0',
      shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 40 },
      transform: [1, 0, 0, 1, 10, 10],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      strokes: [],
      effects: [],
      constraints: { horizontal: 'min', vertical: 'min' },
    };
  }
  return JSON.stringify({
    id: 'doc1',
    name: 'Test',
    formatVersion: '2.3',
    nodes,
    rootChildren: ['f1'],
    pages: [],
    components: {},
    nextId: 1,
  });
}

function renderWithProvider(element: React.ReactElement) {
  return render(
    <EditorProvider initialDocumentJson={buildDocJson(['c1'])}>{element}</EditorProvider>,
  );
}

describe('ConstraintSection', () => {
  it('renders nothing when node has no frame parent', () => {
    const orphan = {
      id: 'orphan',
      kind: 'shape' as const,
      name: 'Orphan',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      order: 'a0',
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 50, h: 40 },
      transform: [1, 0, 0, 1, 10, 10] as const,
      fill: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 } as const,
      strokes: [],
      effects: [],
      constraints: { horizontal: 'min' as const, vertical: 'min' as const },
    };
    const { container } = render(
      <EditorProvider>
        <ConstraintSection nodes={[orphan]} />
      </EditorProvider>,
    );
    // No frame parent in the document → section renders nothing
    expect(container.textContent).toBe('');
  });

  it('renders constraint controls when node is inside a frame', () => {
    const node = {
      id: 'c1',
      kind: 'shape' as const,
      name: 'Child',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      order: 'a0',
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 50, h: 40 },
      transform: [1, 0, 0, 1, 10, 10] as const,
      fill: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 } as const,
      strokes: [],
      effects: [],
      constraints: { horizontal: 'min' as const, vertical: 'min' as const },
    };
    renderWithProvider(<ConstraintSection nodes={[node]} />);
    expect(screen.getAllByText('Constraints').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Horizontal constraint')).toBeTruthy();
    expect(screen.getByLabelText('Vertical constraint')).toBeTruthy();
  });

  it('shows current constraint values from node', () => {
    const node = {
      id: 'c1',
      kind: 'shape' as const,
      name: 'Child',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      order: 'a0',
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 50, h: 40 },
      transform: [1, 0, 0, 1, 10, 10] as const,
      fill: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 } as const,
      strokes: [],
      effects: [],
      constraints: { horizontal: 'stretch' as const, vertical: 'center' as const },
    };
    renderWithProvider(<ConstraintSection nodes={[node]} />);
    expect(screen.getByText('Left & Right')).toBeTruthy();
    expect(screen.getByText('Center')).toBeTruthy();
  });

  it('renders the interactive visual constraint editor', () => {
    const node = {
      id: 'c1',
      kind: 'shape' as const,
      name: 'Child',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      order: 'a0',
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 50, h: 40 },
      transform: [1, 0, 0, 1, 10, 10] as const,
      fill: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 } as const,
      strokes: [],
      effects: [],
      constraints: { horizontal: 'min' as const, vertical: 'min' as const },
    };
    renderWithProvider(<ConstraintSection nodes={[node]} />);
    expect(screen.getByRole('group', { name: 'Visual constraint editor' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pin left edge' })).toBeTruthy();
  });
});
