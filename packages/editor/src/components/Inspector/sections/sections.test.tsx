import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { addChild, createDocument, makeShapeNode, type VariableStore } from '@varve/scene';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { AppearanceSection } from './AppearanceSection';
import { FillSection } from './FillSection';
import { ImagePlacementSection } from './ImagePlacementSection';
import { PositionSizeSection } from './PositionSizeSection';
import { StrokeSection } from './StrokeSection';

afterEach(cleanup);

function createRectNode(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'shape' as const,
    name: 'Rect',
    index: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    order: 'a0',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    transform: [1, 0, 0, 1, 10, 20] as const,
    fill: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 } as const,
    strokes: [],
    effects: [],
    ...overrides,
  };
}

function renderWithProvider(element: React.ReactElement) {
  return render(<EditorProvider>{element}</EditorProvider>);
}

function boundOpacityDocument() {
  const document = createDocument('bound opacity');
  const rootId = document.pages?.[0]?.contentRoot as string;
  const node = makeShapeNode('opacity-bound-rect', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 });
  let next = addChild(document, rootId, node);
  const variableStore: VariableStore = {
    variables: {
      opacity: {
        id: 'opacity',
        name: 'Card opacity',
        type: 'number',
        valuesByMode: { default: 0.4 },
      },
    },
    collections: {},
    activeCollectionId: '',
    modes: ['default'],
    activeMode: 'default',
  };
  const boundNode = next.nodes[node.id];
  if (!boundNode) throw new Error('bound opacity fixture node was not added');
  next = {
    ...next,
    variableStore,
    nodes: {
      ...next.nodes,
      [node.id]: { ...boundNode, bindings: { opacity: { variableId: 'opacity' } } },
    },
  };
  return {
    document: next,
    node: { ...boundNode, bindings: { opacity: { variableId: 'opacity' } } },
  };
}

function createTextNode(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'text' as const,
    name: 'Label',
    index: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    order: 'a0',
    text: 'Hello world',
    fontSize: 16,
    transform: [1, 0, 0, 1, 10, 20] as const,
    fill: { space: 'rgb' as const, r: 240, g: 240, b: 240, a: 255 } as const,
    strokes: [],
    effects: [],
    ...overrides,
  };
}

// ── PositionSizeSection ────────────────────────────────────────────────────

describe('PositionSizeSection', () => {
  it('renders X, Y fields from transform', () => {
    const node = createRectNode('n1');
    renderWithProvider(<PositionSizeSection nodes={[node]} />);
    expect(screen.getByLabelText(/X.*\(px\)/)).toBeTruthy();
    expect(screen.getByLabelText(/Y.*\(px\)/)).toBeTruthy();
    expect(screen.getByLabelText('W (px)')).toBeTruthy();
    expect(screen.getByLabelText('H (px)')).toBeTruthy();
  });

  it('keeps responsive clamp sizing out of core geometry', () => {
    const node = createRectNode('n1');
    renderWithProvider(<PositionSizeSection nodes={[node]} />);
    expect(screen.queryByLabelText('Min W (px)')).toBeNull();
    expect(screen.queryByLabelText('Max W (px)')).toBeNull();
    expect(screen.queryByLabelText('Min H (px)')).toBeNull();
    expect(screen.queryByLabelText('Max H (px)')).toBeNull();
  });

  it('shows Mixed for X axis when values differ', () => {
    const nodeA = createRectNode('n1', { transform: [1, 0, 0, 1, 10, 20] as const });
    const nodeB = createRectNode('n2', { transform: [1, 0, 0, 1, 30, 20] as const });
    renderWithProvider(<PositionSizeSection nodes={[nodeA, nodeB]} />);
    const input = screen.getByLabelText(/X.*\(px\)/) as HTMLInputElement;
    expect(input.getAttribute('aria-valuetext')).toBe('Mixed values');
  });

  it('renders proportion lock toggle button', () => {
    const node = createRectNode('n1');
    renderWithProvider(<PositionSizeSection nodes={[node]} />);
    const lockBtn = screen.getByRole('checkbox', {
      name: /constrain proportions/i,
    }) as HTMLInputElement;
    expect(lockBtn).toBeTruthy();
    expect(lockBtn.checked).toBe(false);
  });

  it('toggles proportion lock on click', () => {
    const node = createRectNode('n1');
    renderWithProvider(<PositionSizeSection nodes={[node]} />);
    const lockBtn = screen.getByRole('checkbox', {
      name: /constrain proportions/i,
    }) as HTMLInputElement;
    fireEvent.click(lockBtn);
    expect(lockBtn.checked).toBe(true);
    fireEvent.click(lockBtn);
    expect(lockBtn.checked).toBe(false);
  });
});

// ── AppearanceSection ───────────────────────────────────────────────────────

describe('AppearanceSection', () => {
  it('renders opacity and blend mode controls', () => {
    const node = createRectNode('n1');
    renderWithProvider(<AppearanceSection nodes={[node]} />);
    expect(screen.getByLabelText('Opacity (%)')).toHaveValue('100');
    expect(screen.getByLabelText('Blend mode')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Effect Studio' })).toBeNull();
  });

  it('shows opacity Mixed indicator for multi-select with differing values', () => {
    const nodeA = createRectNode('n1', { opacity: 0.5 });
    const nodeB = createRectNode('n2', { opacity: 1 });
    renderWithProvider(<AppearanceSection nodes={[nodeA, nodeB]} />);
    const input = screen.getByLabelText('Opacity (%)') as HTMLInputElement;
    expect(input.getAttribute('aria-valuetext')).toBe('Mixed values');
  });

  it('keeps variable-bound opacity readable and exposes its source', () => {
    const fixture = boundOpacityDocument();
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(fixture.document)}>
        <AppearanceSection nodes={[fixture.node]} />
      </EditorProvider>,
    );

    const input = screen.getByLabelText('Opacity (%)') as HTMLInputElement;
    expect(input).toHaveValue('40');
    expect(input).toHaveAttribute('aria-readonly', 'true');
    expect(screen.getByRole('status', { name: /bound to variable: card opacity/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unbind variable Card opacity' })).toBeTruthy();
  });
});

// ── FillSection ──────────────────────────────────────────────────────────

/** Renders a section against the live editor selection so edits round-trip. */
function renderSelectedSection(
  makeSection: (nodes: import('@varve/scene').SceneNode[]) => React.ReactElement,
  nodeOverrides: Record<string, unknown>,
) {
  const document = createDocument('paint rows');
  const rootId = document.pages?.[0]?.contentRoot as string;
  const node = {
    ...makeShapeNode('paint-rect', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }),
    ...nodeOverrides,
  };
  const withNode = addChild(document, rootId, node as import('@varve/scene').SceneNode);
  let ctx: ReturnType<typeof useEditor> | undefined;
  function Harness() {
    ctx = useEditor();
    // biome-ignore lint/correctness/useExhaustiveDependencies: select once on mount
    React.useEffect(() => {
      ctx?.setSelection(node.id);
    }, []);
    const nodes = ctx.selectedNodes();
    return nodes.length > 0 ? makeSection(nodes) : null;
  }
  render(
    <EditorProvider initialDocumentJson={JSON.stringify(withNode)}>
      <Harness />
    </EditorProvider>,
  );
  return { nodeId: node.id, getCtx: () => ctx };
}

describe('Paint rows', () => {
  const solid = { space: 'rgb' as const, r: 20, g: 120, b: 220, a: 255 };

  it('shows fill opacity as a percentage and stores it as a 0–1 fraction', async () => {
    const { nodeId, getCtx } = renderSelectedSection((nodes) => <FillSection nodes={nodes} />, {
      fills: [{ type: 'solid', color: solid, opacity: 0.35, blendMode: 'normal', visible: true }],
    });
    const input = await screen.findByLabelText('Fill opacity (%)');
    expect(input).toHaveValue('35');

    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[nodeId] as { fills?: { opacity: number }[] };
      expect(stored.fills?.[0]?.opacity).toBeCloseTo(0.25, 5);
    });
  });

  it('keeps each paint row on one line with its row commands in a labelled menu', async () => {
    renderSelectedSection((nodes) => <FillSection nodes={nodes} />, {
      fills: [{ type: 'solid', color: solid, opacity: 1, blendMode: 'normal', visible: true }],
    });
    const visibility = await screen.findByRole('switch', { name: 'Hide Fill' });
    const row = visibility.closest('.insp-paint-row');
    expect(row).not.toBeNull();
    expect(row?.querySelector('[aria-label="Fill actions"]')).not.toBeNull();
    // Reorder/remove moved into the menu instead of an unlabelled icon strip.
    expect(screen.queryByRole('button', { name: 'Move Fill up' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fill actions' }));
    expect(await screen.findByRole('menuitem', { name: /remove fill/i })).toBeTruthy();
  });

  it('names stroke position in full words and weight with its unit', async () => {
    renderSelectedSection((nodes) => <StrokeSection nodes={nodes} />, {
      strokes: [
        {
          id: 'stroke-a',
          color: solid,
          weight: 2,
          align: 'inside',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
        },
      ],
    });
    expect(await screen.findByLabelText('Stroke weight (px)')).toHaveValue('2');
    expect(screen.getByRole('combobox', { name: 'Stroke position' })).toHaveTextContent('Inside');
  });
});

describe('FillSection', () => {
  it('renders exactly one contrast indicator for a text node with a solid fill', () => {
    // Regression test: FillRow used to render two ContrastIndicator components
    // for text nodes — one importing the wrong (fgColor/bgColor) props shape,
    // which crashed at runtime since that component actually expects
    // fill/fillIndex. Only the correct one should render. FillRow doesn't
    // pass a `background`, so checkContrast always returns a "background not
    // determined" warning — the dot renders regardless of the color chosen.
    const node = createTextNode('t1', {
      fill: { space: 'rgb' as const, r: 245, g: 245, b: 245, a: 255 },
    });
    const { container } = renderWithProvider(<FillSection nodes={[node]} />);
    const dots = container.querySelectorAll('.insp-contrast-dot');
    expect(dots).toHaveLength(1);
    expect(dots[0]?.className).toContain('insp-contrast-dot--warn');
  });
});

describe('ImagePlacementSection', () => {
  it('can transition from an incompatible node to an image without changing hook order', () => {
    const rect = createRectNode('n1');
    const image = createRectNode('i1', {
      fills: [
        {
          type: 'image' as const,
          image: {
            src: 'data:image/png;base64,AA',
            fit: 'fill' as const,
            x: 0,
            y: 0,
            scale: 1,
          },
        },
      ],
    });
    const view = renderWithProvider(<ImagePlacementSection nodes={[rect]} />);
    expect(screen.queryByText('Image Placement')).toBeNull();
    expect(() =>
      view.rerender(
        <EditorProvider>
          <ImagePlacementSection nodes={[image]} />
        </EditorProvider>,
      ),
    ).not.toThrow();
    expect(screen.getAllByText('Image Placement')).toHaveLength(2);
  });
});
