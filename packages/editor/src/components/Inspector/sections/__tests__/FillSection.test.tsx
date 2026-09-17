import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { addChild, createDocument, type ManagedColor, makeShapeNode } from '@varve/scene';
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
) {
  const document = createDocument('fill-test-doc');
  const rootId = document.pages?.[0]?.contentRoot as string;
  const node = {
    ...makeShapeNode('fill-rect', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 }),
    ...nodeOverrides,
  };
  const withNode = addChild(document, rootId, node as import('@varve/scene').SceneNode);
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
    <EditorProvider initialDocumentJson={JSON.stringify(withNode)}>
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

  it('multi-fill stack: exposes drag handles and labelled menu reorder fallbacks', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Fill actions' }));
    const fill1Up = await screen.findByRole('menuitem', { name: 'Move fill up' });
    const fill1Down = screen.getByRole('menuitem', { name: 'Move fill down' });
    expect(fill1Up).toBeDisabled();
    expect(fill1Down).not.toBeDisabled();
    fireEvent.keyDown(fill1Up, { key: 'Escape' });

    // Fill 2 (index 1, middle): can move up and can move down.
    fireEvent.click(screen.getByRole('button', { name: 'Fill 2 actions' }));
    const fill2Up = await screen.findByRole('menuitem', { name: 'Move fill 2 up' });
    const fill2Down = screen.getByRole('menuitem', { name: 'Move fill 2 down' });
    expect(fill2Up).not.toBeDisabled();
    expect(fill2Down).not.toBeDisabled();
    fireEvent.keyDown(fill2Up, { key: 'Escape' });

    // Fill 3 (index 2, top of stack): can move up, cannot move down.
    fireEvent.click(screen.getByRole('button', { name: 'Fill 3 actions' }));
    const fill3Up = await screen.findByRole('menuitem', { name: 'Move fill 3 up' });
    const fill3Down = screen.getByRole('menuitem', { name: 'Move fill 3 down' });
    expect(fill3Up).not.toBeDisabled();
    expect(fill3Down).toBeDisabled();
    fireEvent.keyDown(fill3Up, { key: 'Escape' });

    // Click Move fill down on Fill 1: reorders Fill 1 to index 1
    fireEvent.click(screen.getByRole('button', { name: 'Fill actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move fill down' }));
    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[nodeId] as {
        fills?: { color?: { r: number } }[];
      };
      // Original colorA was index 0, now should be index 1
      expect(stored.fills?.[1]?.color?.r).toBe(colorA.r);
      expect(stored.fills?.[0]?.color?.r).toBe(colorB.r);
    });
  });

  it('multi-fill stack: keeps destructive removal in the labelled overflow menu', async () => {
    const { nodeId, getCtx } = renderSelectedSection((nodes) => <FillSection nodes={nodes} />, {
      fills: [
        { type: 'solid', color: colorA, opacity: 1, blendMode: 'normal', visible: true },
        { type: 'solid', color: colorB, opacity: 0.7, blendMode: 'normal', visible: true },
      ],
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Fill actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Remove fill' })).toBeTruthy();
    const removeFill1 = await screen.findByRole('menuitem', { name: 'Remove fill' });
    fireEvent.keyDown(removeFill1, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Fill 2 actions' }));
    const removeFill2 = await screen.findByRole('menuitem', { name: 'Remove fill 2' });
    expect(removeFill2).toBeTruthy();

    fireEvent.click(removeFill2);
    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[nodeId] as { fills?: unknown[] };
      expect(stored.fills?.length).toBe(1);
    });
  });

  it('multi-fill stack: keeps per-fill blend mode in the labelled actions menu', async () => {
    const { nodeId, getCtx } = renderSelectedSection((nodes) => <FillSection nodes={nodes} />, {
      fills: [
        { type: 'solid', color: colorA, opacity: 1, blendMode: 'normal', visible: true },
        { type: 'solid', color: colorB, opacity: 0.8, blendMode: 'normal', visible: true },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Fill 2 actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Blend mode/ }));

    // Select Multiply
    const multiplyOption = await screen.findByRole('menuitemradio', { name: 'Multiply' });
    fireEvent.click(multiplyOption);

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
