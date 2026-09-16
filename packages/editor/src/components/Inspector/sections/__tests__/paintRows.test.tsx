// @vitest-environment jsdom
/**
 * Paint-row redesign contract — Fill and Stroke.
 *
 * These tests drive the live EditorProvider selection so edits round-trip to
 * the document, the same boundary the Inspector uses at runtime. They pin the
 * behaviours the redesign adds on top of the 2026-09-16 fill pass:
 *
 *  - fill type is a compact labelled trigger, not a full-width combobox;
 *  - the row states its value (#hex / Gradient / Mixed) without opening a picker;
 *  - mixed selections are named, and paint edits never touch unpaintable nodes;
 *  - stroke dash presets replace raw-number-only entry, with the custom field
 *    kept for precision;
 *  - miter limit appears only for miter joins, per-side widths are a mode with
 *    a way back, arrowheads share one row, and a new stroke copies the last one.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  addChild,
  createDocument,
  type ManagedColor,
  makeGroupNode,
  makeShapeNode,
  type SceneNode,
} from '@varve/scene';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../../context';
import { FillSection } from '../FillSection';
import { StrokeSection } from '../StrokeSection';

afterEach(cleanup);

const BLUE: ManagedColor = { space: 'rgb', r: 20, g: 120, b: 220, a: 255 };
const RED: ManagedColor = { space: 'rgb', r: 220, g: 40, b: 60, a: 255 };

type Overrides = Record<string, unknown>;

function addNodes(document: ReturnType<typeof createDocument>, entries: [string, Overrides][]) {
  let next = document;
  const rootId = next.pages?.[0]?.contentRoot as string;
  for (const [id, overrides] of entries) {
    const base = id.startsWith('g')
      ? makeGroupNode(id, { children: [] })
      : makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 100, h: 80 });
    next = addChild(next, rootId, { ...base, ...overrides } as SceneNode);
  }
  return next;
}

function renderWithSelection(
  makeSection: (nodes: SceneNode[]) => React.ReactElement,
  entries: [string, Overrides][],
) {
  const document = addNodes(createDocument('paint-rows'), entries);
  let ctx: ReturnType<typeof useEditor> | undefined;
  function Harness() {
    ctx = useEditor();
    React.useEffect(() => {
      const [first, ...rest] = entries;
      if (!first) return;
      ctx?.setSelection(first[0]);
      for (const [id] of rest) ctx?.toggleSelection(id, true);
    }, []);
    const nodes = ctx.selectedNodes();
    return nodes.length > 0 ? makeSection(nodes) : null;
  }
  render(
    <EditorProvider initialDocumentJson={JSON.stringify(document)}>
      <Harness />
    </EditorProvider>,
  );
  return { getCtx: () => ctx, ids: entries.map(([id]) => id) };
}

const solidFill = (color: ManagedColor, extra: Overrides = {}) => ({
  fills: [{ type: 'solid', color, opacity: 1, blendMode: 'normal', visible: true, ...extra }],
});

const stroke = (extra: Overrides = {}) => [
  {
    id: 'stroke-a',
    color: BLUE,
    weight: 2,
    align: 'center',
    dashPattern: [],
    dashOffset: 0,
    cap: 'round',
    join: 'miter',
    miterLimit: 4,
    visible: true,
    ...extra,
  },
];

describe('Fill row redesign', () => {
  it('shows a compact type trigger and the solid hex value, not a type combobox', async () => {
    renderWithSelection((nodes) => <FillSection nodes={nodes} />, [['fill-rect', solidFill(BLUE)]]);

    const trigger = await screen.findByRole('button', { name: 'Fill type: Solid' });
    expect(trigger).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Fill type' })).toBeNull();
    // The value readout states the paint without opening the picker.
    expect(screen.getByText('#1478DC')).toBeTruthy();
  });

  it('changes the fill type from the type menu and preserves the solid colour', async () => {
    const { getCtx, ids } = renderWithSelection(
      (nodes) => <FillSection nodes={nodes} />,
      [['fill-rect', solidFill(BLUE)]],
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Fill type: Solid' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Gradient' }));

    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[ids[0]!] as {
        fills?: { type: string; gradient?: { stops: { color: { r: number } }[] } }[];
      };
      expect(stored.fills?.[0]?.type).toBe('gradient');
      expect(stored.fills?.[0]?.gradient?.stops[0]?.color.r).toBe(BLUE.r);
    });
  });

  it('names the first fill "Fill type" and stacked rows "Fill 2 type"', async () => {
    renderWithSelection(
      (nodes) => <FillSection nodes={nodes} />,
      [
        [
          'fill-rect',
          {
            fills: [
              { type: 'solid', color: BLUE, opacity: 1, blendMode: 'normal', visible: true },
              { type: 'solid', color: RED, opacity: 1, blendMode: 'normal', visible: true },
            ],
          },
        ],
      ],
    );

    expect(await screen.findByRole('button', { name: 'Fill type: Solid' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fill 2 type: Solid' })).toBeTruthy();
  });

  it('shows "Mixed" on the row when selected layers disagree, and says so in the name', async () => {
    renderWithSelection(
      (nodes) => <FillSection nodes={nodes} />,
      [
        ['fill-a', solidFill(BLUE)],
        ['fill-b', solidFill(RED)],
      ],
    );

    const mixedSwatch = await screen.findByRole('button', {
      name: /Fill colour \(mixed across selection/,
    });
    expect(mixedSwatch).toBeTruthy();
    expect(screen.getByText('Mixed')).toBeTruthy();
  });

  it('disables Remove on a single fill instead of failing silently', async () => {
    renderWithSelection((nodes) => <FillSection nodes={nodes} />, [['fill-rect', solidFill(BLUE)]]);

    fireEvent.click(await screen.findByRole('button', { name: 'Fill actions' }));
    const remove = await screen.findByRole('menuitem', { name: /remove fill/i });
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove).toHaveTextContent(/last fill/i);
  });

  it('renders nothing for a group-only selection (groups never paint fills)', () => {
    const group = makeGroupNode('g1', { children: [] });
    const document = addNodes(createDocument('group-only'), [['g1', {}]]);
    expect(document.nodes.g1?.kind).toBe('group');
    const { container } = render(
      <EditorProvider initialDocumentJson={JSON.stringify(document)}>
        <FillSection nodes={[group]} />
      </EditorProvider>,
    );
    expect(container.querySelector('.insp-fill-row')).toBeNull();
  });

  it('never writes fills into non-paintable layers of a mixed selection', async () => {
    const { getCtx, ids } = renderWithSelection(
      (nodes) => <FillSection nodes={nodes} />,
      [
        ['g1', {}],
        ['fill-b', solidFill(BLUE)],
      ],
    );

    const opacity = await screen.findByLabelText('Fill opacity (%)');
    fireEvent.change(opacity, { target: { value: '40' } });
    fireEvent.keyDown(opacity, { key: 'Enter' });

    await waitFor(() => {
      const rect = getCtx()?.state.document.nodes[ids[1]!] as { fills?: { opacity: number }[] };
      expect(rect.fills?.[0]?.opacity).toBeCloseTo(0.4, 5);
    });
    const group = getCtx()?.state.document.nodes[ids[0]!] as { fills?: unknown[] };
    expect(group.fills).toBeUndefined();
  });
  it('exposes blend mode inside the fill popover and applies it in one commit', async () => {
    const { getCtx, ids } = renderWithSelection(
      (nodes) => <FillSection nodes={nodes} />,
      [['fill-rect', solidFill(BLUE)]],
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Fill colour' }));
    const dialog = await screen.findByRole('dialog', { name: /fill colour/i });
    const blend = within(dialog).getByRole('combobox', { name: 'Fill blend mode' });
    expect(blend).toHaveTextContent('Normal');
    fireEvent.click(blend);
    fireEvent.click(await screen.findByRole('option', { name: 'Multiply' }));

    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[ids[0]!] as {
        fills?: { blendMode?: string }[];
      };
      expect(stored.fills?.[0]?.blendMode).toBe('multiply');
    });
    // The row chip follows the committed value, staying in sync with the popover.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /blend mode: multiply/i })).toBeTruthy();
    });
    // With a non-normal blend the row keeps the full hex: opacity moved to
    // the properties line beside the chip instead of squeezing the pill.
    expect(screen.getByText('#1478DC')).toBeTruthy();
    expect(screen.getByLabelText('Fill opacity (%)')).toBeTruthy();
  });

  it('shows a Mixed blend placeholder in the popover for disagreeing layers', async () => {
    // Same paint colour, different blend: the row keeps the shared hex and a
    // "Mixed blend" chip, while the popover's blend select says Mixed.
    renderWithSelection(
      (nodes) => <FillSection nodes={nodes} />,
      [
        ['fill-a', solidFill(BLUE)],
        [
          'fill-b',
          {
            fills: [
              {
                type: 'solid',
                color: BLUE,
                opacity: 1,
                blendMode: 'multiply',
                visible: true,
              },
            ],
          },
        ],
      ],
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Fill colour' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Fill blend mode' })).toHaveTextContent(
      'Mixed',
    );
  });
});

describe('Stroke advanced redesign', () => {
  it('offers dash presets and keeps the custom pattern field for precision', async () => {
    const { getCtx, ids } = renderWithSelection(
      (nodes) => <StrokeSection nodes={nodes} />,
      [['stroke-rect', { strokes: stroke() }]],
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Advanced' }));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Stroke dash style' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Dashed' }));

    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[ids[0]!] as {
        strokes?: { dashPattern: number[] }[];
      };
      expect(stored.strokes?.[0]?.dashPattern).toEqual([8, 4]);
    });
    // The collapsed summary states the dash style without expanding again.
    expect(screen.getByRole('button', { name: /^Advanced/ })).toHaveTextContent('Dashed');

    fireEvent.click(screen.getByRole('combobox', { name: 'Stroke dash style' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Custom…' }));
    expect(await screen.findByLabelText('Stroke dash pattern')).toBeTruthy();
  });

  it('shows Miter limit only while the join is miter', async () => {
    renderWithSelection(
      (nodes) => <StrokeSection nodes={nodes} />,
      [['stroke-rect', { strokes: stroke() }]],
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Advanced' }));
    expect(await screen.findByRole('spinbutton', { name: 'Miter limit' })).toBeTruthy();

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Stroke join' })).getByRole('radio', {
        name: 'Round',
      }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('spinbutton', { name: 'Miter limit' })).toBeNull();
    });
  });

  it('makes per-side widths a mode with a way back to one width', async () => {
    const { getCtx, ids } = renderWithSelection(
      (nodes) => <StrokeSection nodes={nodes} />,
      [['stroke-rect', { strokes: stroke() }]],
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Advanced' }));
    const perSideSwitch = await screen.findByRole('switch', { name: 'Stroke per-side widths' });
    fireEvent.click(perSideSwitch);

    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[ids[0]!] as {
        strokes?: { perSideWeights?: number[] }[];
      };
      expect(stored.strokes?.[0]?.perSideWeights).toEqual([2, 2, 2, 2]);
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Use one width' }));
    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[ids[0]!] as {
        strokes?: { perSideWeights?: number[] }[];
      };
      expect(stored.strokes?.[0]?.perSideWeights).toBeUndefined();
    });
  });

  it('keeps both arrowhead pickers on one row for lines', async () => {
    renderWithSelection(
      (nodes) => <StrokeSection nodes={nodes} />,
      [
        [
          'line-shape',
          {
            ...makeShapeNode('line-shape', {
              kind: 'line',
              from: [0, 0],
              to: [100, 0],
              tolerance: 3,
            }),
            strokes: stroke(),
          },
        ],
      ],
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Advanced' }));
    const start = await screen.findByRole('combobox', { name: 'Stroke arrowhead start' });
    const end = screen.getByRole('combobox', { name: 'Stroke arrowhead end' });
    expect(start.closest('.insp-paint-advanced__pair')).toBe(
      end.closest('.insp-paint-advanced__pair'),
    );
  });

  it('copies the previous stroke style when adding a stroke', async () => {
    const { getCtx, ids } = renderWithSelection(
      (nodes) => <StrokeSection nodes={nodes} />,
      [
        [
          'stroke-rect',
          {
            strokes: stroke({ color: RED, dashPattern: [8, 4], cap: 'square' }),
          },
        ],
      ],
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add Stroke' }));

    await waitFor(() => {
      const stored = getCtx()?.state.document.nodes[ids[0]!] as {
        strokes?: { color: { r: number }; dashPattern: number[]; cap: string }[];
      };
      expect(stored.strokes?.length).toBe(2);
      expect(stored.strokes?.[1]?.color.r).toBe(RED.r);
      expect(stored.strokes?.[1]?.dashPattern).toEqual([8, 4]);
      expect(stored.strokes?.[1]?.cap).toBe('square');
    });
  });

  it('flags a zero-width stroke as invisible', async () => {
    renderWithSelection(
      (nodes) => <StrokeSection nodes={nodes} />,
      [['stroke-rect', { strokes: stroke({ weight: 0 }) }]],
    );

    expect(await screen.findByRole('note')).toHaveTextContent(/zero width/i);
  });
});
