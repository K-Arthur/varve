import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  addChild,
  createDocument,
  createVariableStore,
  type ManagedColor,
  makeShapeNode,
  patternFill,
} from '@varve/scene';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../../context';
import { FillSection } from '../FillSection';

afterEach(cleanup);

const colorA: ManagedColor = { space: 'rgb', r: 20, g: 120, b: 220, a: 255 };
const colorB: ManagedColor = { space: 'rgb', r: 220, g: 40, b: 60, a: 255 };
const colorC: ManagedColor = { space: 'rgb', r: 40, g: 200, b: 100, a: 255 };

function renderSelectedSection(
  makeSection: (nodes: import('@varve/scene').SceneNode[]) => React.ReactElement,
  nodeOverrides: Record<string, unknown>,
  decorateDoc?: (doc: import('@varve/scene').Document) => import('@varve/scene').Document,
) {
  const document = createDocument('fill-test-doc');
  const rootId = document.pages?.[0]?.contentRoot as string;
  const node = {
    ...makeShapeNode('fill-rect', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }),
    ...nodeOverrides,
  };
  const withNode = addChild(document, rootId, node as import('@varve/scene').SceneNode);
  const prepared = decorateDoc ? decorateDoc(withNode) : withNode;
  let ctx: ReturnType<typeof useEditor> | undefined;
  function Harness() {
    ctx = useEditor();
    React.useEffect(() => {
      ctx?.setSelection(node.id);
    }, []);
    const nodes = ctx.selectedNodes();
    return nodes.length > 0 ? makeSection(nodes) : null;
  }
  render(
    <EditorProvider initialDocumentJson={JSON.stringify(prepared)}>
      <Harness />
    </EditorProvider>,
  );
  return { nodeId: node.id, getCtx: () => ctx };
}

describe('FillSection Redesign & Multi-Fill Controls', () => {
  it('single fill: shows a scrubbable opacity field, hides direct stack clutter, and keeps actions labelled', async () => {
    const { nodeId, getCtx } = renderSelectedSection((nodes) => <FillSection nodes={nodes} />, {
      fills: [{ type: 'solid', color: colorA, opacity: 0.8, blendMode: 'normal', visible: true }],
    });

    // Opacity input has full accessible name and shows initial value
    const input = await screen.findByLabelText('Fill opacity (%)');
    expect(input).toHaveValue('80');

    // The visible label remains the scrub target while the input keeps its
    // complete accessible name.
    const label = screen.getByText('Opacity (%)');
    expect(label).toBeTruthy();

    // Reorder and remove buttons are NOT rendered for a single fill
    expect(screen.queryByRole('button', { name: 'Move fill up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move fill down' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove fill' })).toBeNull();

    // Blend chip is hidden when normal for a single fill (avoids clutter)
    expect(screen.queryByRole('button', { name: /blend mode/i })).toBeNull();

    // Actions menu is available
    expect(screen.getByRole('button', { name: 'Fill actions' })).toBeTruthy();

    // Editing opacity persists to document
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[nodeId] as { fills?: { opacity: number }[] };
      expect(stored.fills?.[0]?.opacity).toBeCloseTo(0.45, 5);
    });
  });

  it('multi-fill stack: exposes drag handles and direct reorder controls', async () => {
    const { nodeId, getCtx } = renderSelectedSection((nodes) => <FillSection nodes={nodes} />, {
      fills: [
        { type: 'solid', color: colorA, opacity: 1, blendMode: 'normal', visible: true },
        { type: 'solid', color: colorB, opacity: 0.7, blendMode: 'normal', visible: true },
        { type: 'solid', color: colorC, opacity: 0.5, blendMode: 'normal', visible: true },
      ],
    });

    // Wait for rows to render
    expect(await screen.findByLabelText('Fill opacity (%)')).toBeTruthy();
    expect(screen.getByLabelText('Fill 2 opacity (%)')).toBeTruthy();
    expect(screen.getByLabelText('Fill 3 opacity (%)')).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Drag fill to reorder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Drag fill 2 to reorder' })).toBeTruthy();

    // Fill 1 (index 0, bottom of stack): cannot move up, can move down.
    expect(screen.getByRole('button', { name: 'Move fill up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move fill down' })).not.toBeDisabled();

    // Fill 2 (index 1, middle): can move up and can move down.
    expect(screen.getByRole('button', { name: 'Move fill 2 up' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move fill 2 down' })).not.toBeDisabled();

    // Fill 3 (index 2, top of stack): can move up, cannot move down.
    expect(screen.getByRole('button', { name: 'Move fill 3 up' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move fill 3 down' })).toBeDisabled();

    // Click Move fill down on Fill 1: reorders Fill 1 to index 1
    fireEvent.click(screen.getByRole('button', { name: 'Move fill down' }));
    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[nodeId] as {
        fills?: { color?: { r: number } }[];
      };
      // Original colorA was index 0, now should be index 1
      expect(stored.fills?.[1]?.color?.r).toBe(colorA.r);
      expect(stored.fills?.[0]?.color?.r).toBe(colorB.r);
    });
  });

  it('multi-fill stack: removes a fill directly from its row', async () => {
    const { nodeId, getCtx } = renderSelectedSection((nodes) => <FillSection nodes={nodes} />, {
      fills: [
        { type: 'solid', color: colorA, opacity: 1, blendMode: 'normal', visible: true },
        { type: 'solid', color: colorB, opacity: 0.7, blendMode: 'normal', visible: true },
      ],
    });

    const removeFill2 = await screen.findByRole('button', { name: 'Remove fill 2' });
    fireEvent.click(removeFill2);
    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[nodeId] as { fills?: unknown[] };
      expect(stored.fills?.length).toBe(1);
    });
  });

  it('multi-fill stack: keeps per-fill blend mode in the labelled actions menu', async () => {
    const user = userEvent.setup();
    const { nodeId, getCtx } = renderSelectedSection((nodes) => <FillSection nodes={nodes} />, {
      fills: [
        { type: 'solid', color: colorA, opacity: 1, blendMode: 'normal', visible: true },
        { type: 'solid', color: colorB, opacity: 0.8, blendMode: 'normal', visible: true },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Fill 2 actions' }));
    await user.click(await screen.findByRole('menuitem', { name: /Blend mode/ }));

    // Select Multiply
    const multiplyOption = await screen.findByRole('menuitemradio', { name: 'Multiply' });
    await user.click(multiplyOption);

    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[nodeId] as {
        fills?: { blendMode?: string }[];
      };
      expect(stored.fills?.[1]?.blendMode).toBe('multiply');
    });
  });

  it('real-world complex fill stack: supports opacity scrubbing via horizontal drag on Op label', async () => {
    renderSelectedSection((nodes) => <FillSection nodes={nodes} />, {
      fills: [{ type: 'solid', color: colorA, opacity: 0.5, blendMode: 'normal', visible: true }],
    });

    const label = await screen.findByText('Opacity (%)');
    expect(label).toBeTruthy();

    // Start scrub gesture on the Op label
    fireEvent.pointerDown(label, { clientX: 100, clientY: 100, pointerId: 1 });
    // Move pointer right
    fireEvent.pointerMove(window, { clientX: 140, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 140, clientY: 100, pointerId: 1 });

    // The opacity input receives scrubbed updates
    const input = screen.getByLabelText('Fill opacity (%)') as HTMLInputElement;
    expect(Number(input.value)).toBeGreaterThan(50);
  });
});

describe('FillSection variable-link honesty', () => {
  const solidA = {
    type: 'solid' as const,
    color: colorA,
    opacity: 1,
    blendMode: 'normal' as const,
    visible: true,
  };
  const solidB = {
    type: 'solid' as const,
    color: colorB,
    opacity: 1,
    blendMode: 'normal' as const,
    visible: true,
  };
  const gradientA = {
    type: 'gradient' as const,
    opacity: 1,
    blendMode: 'normal' as const,
    visible: true,
    gradient: {
      type: 'linear' as const,
      stops: [
        { position: 0, color: colorA },
        { position: 1, color: colorB },
      ],
    },
  };

  function withBrandVariable(doc: import('@varve/scene').Document) {
    const store = createVariableStore(['default']);
    store.variables.brand = {
      id: 'brand',
      name: 'Brand Red',
      type: 'color',
      valuesByMode: { default: '#ff007f' },
    };
    store.collections.c1 = {
      id: 'c1',
      name: 'Tokens',
      modes: ['default'],
      activeMode: 'default',
      variableIds: ['brand'],
    };
    store.activeCollectionId = 'c1';
    return { ...doc, variableStore: store };
  }

  it('offers "Link to variable" on the primary solid row', async () => {
    renderSelectedSection((nodes) => <FillSection nodes={nodes} />, { fills: [solidA] });
    fireEvent.click(await screen.findByRole('button', { name: 'Fill actions' }));
    const menu = await screen.findByRole('menu');
    const item = within(menu).getByRole('menuitem', { name: 'Link to variable' });
    expect(item).not.toBeDisabled();
  });

  it('does not offer the binding on secondary rows (the binding drives one slot)', async () => {
    renderSelectedSection((nodes) => <FillSection nodes={nodes} />, {
      fills: [solidA, solidB],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Fill 2 actions' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Link to variable' })).toBeNull();
  });

  it('explains why a gradient primary paint cannot take a colour binding', async () => {
    renderSelectedSection((nodes) => <FillSection nodes={nodes} />, {
      fills: [gradientA, solidB],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Fill actions' }));
    const menu = await screen.findByRole('menu');
    // The description is part of the accessible name, so match loosely.
    const item = within(menu).getByRole('menuitem', { name: /Link to variable/ });
    expect(item).toBeDisabled();
    expect(within(menu).getByText(/variable colours apply to solid paints/)).toBeTruthy();
  });

  it('keeps the badge but reports the link as not applied on a gradient paint', async () => {
    renderSelectedSection(
      (nodes) => <FillSection nodes={nodes} />,
      { fills: [gradientA], bindings: { fill: { variableId: 'brand' } } },
      withBrandVariable,
    );
    const badge = await screen.findByRole('button', { name: /not applied/i });
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('$Brand Red');
    expect(badge.textContent).toContain('(not applied)');
  });

  it('detaches the link when the bound colour is edited instead of silently losing the edit', async () => {
    const { nodeId, getCtx } = renderSelectedSection(
      (nodes) => <FillSection nodes={nodes} />,
      { fills: [solidA], bindings: { fill: { variableId: 'brand' } } },
      withBrandVariable,
    );
    // The bound badge is present and reported as applied.
    const badge = await screen.findByRole('button', { name: /linked to brand red/i });
    expect(badge.textContent).not.toContain('(not applied)');

    fireEvent.click(screen.getByRole('button', { name: 'Fill colour' }));
    const swatch = await screen.findByRole('option', { name: /teal 500/i });
    fireEvent.click(swatch);

    await waitFor(() => {
      const node = getCtx()?.state.document.nodes[nodeId] as {
        bindings?: Record<string, unknown>;
      };
      expect(node.bindings?.fill).toBeUndefined();
    });
    // The authored colour changed to the picked literal (not left stale).
    await waitFor(() => {
      const node = getCtx()?.state.document.nodes[nodeId] as {
        fills?: Array<{ color?: ManagedColor }>;
      };
      expect(node.fills?.[0]?.color).toBeDefined();
      expect(node.fills?.[0]?.color).not.toEqual(colorA);
    });
  });

  it('presents the bound colour as the row value instead of the authored literal', async () => {
    renderSelectedSection(
      (nodes) => <FillSection nodes={nodes} />,
      { fills: [solidA], bindings: { fill: { variableId: 'brand' } } },
      withBrandVariable,
    );
    // solidA is rgb(20,120,220); the variable is #ff007f (rendered uppercase). The row must show
    // what the canvas paints, with the badge naming the source.
    await screen.findByText('#FF007F');
    expect(screen.queryByText('#1478DC')).toBeNull();
  });
});

describe('FillSection shared pattern paint behavior', () => {
  it('shows the effective shared pattern, then requires detach before per-object placement edits', async () => {
    const definitionId = 'pattern-shared';
    const paintId = 'paint-shared-pattern';
    const previewSrc = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`;
    const sharedFill = patternFill(previewSrc, {
      definitionId,
      spacing: 0,
      rotation: 0,
      imageWidth: 12,
      imageHeight: 12,
    });
    const patternDefinition = {
      id: definitionId,
      name: 'Shared leaves',
      revision: 1,
      cell: { x: 0, y: 0, width: 12, height: 12 },
      repeat: {
        arrangement: 'grid' as const,
        gapX: 0,
        gapY: 0,
        rowShift: 0,
        mirrorX: false,
        mirrorY: false,
        originX: 0,
        originY: 0,
      },
      source: {
        kind: 'procedural' as const,
        recipe: {
          type: 'checkerboard' as const,
          tileWidth: 12,
          tileHeight: 12,
          color1: '#fff',
          color2: '#000',
          seed: 0,
        },
      },
      previewSrc,
      previewRevision: 1,
    };
    const { nodeId, getCtx } = renderSelectedSection(
      (nodes) => <FillSection nodes={nodes} />,
      { paintRefs: [paintId] },
      (doc) => ({
        ...doc,
        paints: { [paintId]: { id: paintId, name: 'Shared leaves paint', fill: sharedFill } },
        patternDefinitions: { [definitionId]: patternDefinition },
      }),
    );

    expect(await screen.findByText(/Shared paint: Shared leaves paint/)).toBeTruthy();
    expect(screen.queryByLabelText('Tile width (px)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /detach shared paint to edit/i }));

    const tileWidth = await screen.findByRole('spinbutton', { name: /Tile width/ });
    fireEvent.change(tileWidth, { target: { value: '24' } });
    fireEvent.keyDown(tileWidth, { key: 'Enter' });
    await waitFor(() => {
      const node = getCtx()?.state.document.nodes[nodeId] as {
        paintRefs?: string[];
        fills?: Array<{ pattern?: { definitionId?: string; imageWidth?: number } }>;
      };
      expect(node.paintRefs).toBeUndefined();
      expect(node.fills?.[0]?.pattern?.definitionId).toBe(definitionId);
      expect(node.fills?.[0]?.pattern?.imageWidth).toBe(24);
    });
  });
});
