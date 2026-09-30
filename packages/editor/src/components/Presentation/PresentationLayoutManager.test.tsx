/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  applyOperation,
  createDesignCanvas,
  createDocument,
  type Document,
  makeFrameNode,
  makeShapeNode,
  type PresentationDeck,
  type PresentationSlideEntry,
  registerBuiltinOperations,
} from '@varve/scene';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PresentationLayoutManager } from './PresentationLayoutManager';

afterEach(cleanup);
registerBuiltinOperations();

function fixture(): Document {
  const sourceChild = makeShapeNode(
    'source-text',
    { kind: 'rect', x: 0, y: 0, w: 400, h: 80 },
    { name: 'Source title' },
  );
  const targetChild = makeShapeNode(
    'target-text',
    { kind: 'rect', x: 0, y: 0, w: 80, h: 20 },
    { name: 'Slide title' },
  );
  const source = makeFrameNode('source-frame', {
    name: 'Reusable layout',
    w: 1920,
    h: 1080,
    children: [sourceChild.id],
  });
  const target = makeFrameNode('slide-frame', {
    name: 'Opening',
    w: 1920,
    h: 1080,
    children: [targetChild.id],
  });
  let document: Document = createDesignCanvas(createDocument('Layout manager test', true), {
    name: 'Canvas 1',
  });
  const rootId = document.designCanvases?.[0]?.contentRoot;
  if (rootId) {
    const root = document.nodes[rootId];
    if (root?.kind === 'group') {
      document = {
        ...document,
        nodes: {
          ...document.nodes,
          [sourceChild.id]: sourceChild,
          [targetChild.id]: targetChild,
          [source.id]: source,
          [target.id]: target,
          [rootId]: { ...root, children: [source.id, target.id] },
        },
      };
    }
  }
  document = applyOperation(document, 'presentation.deck.create', {
    id: 'deck',
    name: 'Client pitch',
    width: 1920,
    height: 1080,
  });
  return applyOperation(document, 'presentation.slide.add', {
    deckId: 'deck',
    entry: { id: 'entry', frameId: target.id, title: 'Opening' },
  });
}

function Harness({ operations }: { operations: string[] }) {
  const [initialDocument] = useState(fixture);
  const [document, setDocument] = useState(initialDocument);
  const deck = document.presentation?.decks[0] as PresentationDeck;
  const slide = deck.slides[0] as PresentationSlideEntry;
  const runOperation = useCallback(
    (_label: string, type: string, payload: unknown) => {
      operations.push(type);
      setDocument((current) => applyOperation(current, type, payload));
    },
    [operations],
  );
  const node = document.nodes['target-text'];
  const width = node?.kind === 'shape' && node.shape.kind === 'rect' ? node.shape.w : 0;
  const binding = slide.layoutBinding;
  return (
    <>
      <PresentationLayoutManager
        document={document}
        deck={deck}
        slide={slide}
        selectedFrameId="source-frame"
        runOperation={runOperation}
      />
      <button
        type="button"
        data-testid="move-title"
        onClick={() =>
          setDocument((current) => {
            const currentTitle = current.nodes['target-text'];
            if (currentTitle?.kind !== 'shape' || currentTitle.shape.kind !== 'rect')
              return current;
            return {
              ...current,
              nodes: {
                ...current.nodes,
                'target-text': {
                  ...currentTitle,
                  shape: { ...currentTitle.shape, x: 999 },
                },
              },
            };
          })
        }
      >
        Move slide title
      </button>
      <output data-testid="target-width">{width}</output>
      <output data-testid="layout-names">
        {document.presentation?.layouts.map((layout) => layout.name).join(',')}
      </output>
      <output data-testid="has-binding">{binding ? 'bound' : 'unbound'}</output>
      <output data-testid="operation-list">{operations.join(',')}</output>
    </>
  );
}

/** Register, map, and apply so the slide has a real layout binding. */
async function applyLayout(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText(/Reusable layouts/));
  await user.click(screen.getByRole('button', { name: 'Register layout source' }));
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Slide object for source-title' }),
    'target-text',
  );
  await user.click(screen.getByRole('button', { name: 'Preview and reapply…' }));
  await user.click(
    within(screen.getByRole('dialog', { name: 'Review layout changes' })).getByRole('button', {
      name: 'Apply layout',
    }),
  );
}

describe('PresentationLayoutManager', () => {
  it('adds an editable built-in source through the typed operation', async () => {
    const user = userEvent.setup();
    const operations: string[] = [];
    render(<Harness operations={operations} />);

    await user.click(screen.getByText(/Reusable layouts/));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Built-in layout' }),
      'image-text',
    );
    await user.click(screen.getByRole('button', { name: 'Add editable layout source' }));

    expect(operations).toEqual(['presentation.layout.builtin.create']);
    expect(screen.getByTestId('layout-names').textContent).toBe('Image and text');
    const selectedSource = screen.getByRole('combobox', {
      name: 'Layout source',
    }) as HTMLSelectElement;
    expect(selectedSource.value.startsWith('layout-')).toBe(true);
  });

  it('canceling leaves artwork unchanged; Apply reuses one typed operation', async () => {
    const user = userEvent.setup();
    const operations: string[] = [];
    render(<Harness operations={operations} />);

    await user.click(screen.getByText(/Reusable layouts/));
    await user.click(screen.getByRole('button', { name: 'Register layout source' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Slide object for source-title' }),
      'target-text',
    );
    await user.click(screen.getByRole('button', { name: 'Preview and reapply…' }));

    const dialog = screen.getByRole('dialog', { name: 'Review layout changes' });
    expect(within(dialog).getByText(/geometry changes/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(operations).toEqual(['presentation.layout.register']);
    expect(screen.getByTestId('target-width').textContent).toBe('80');

    await user.click(screen.getByRole('button', { name: 'Preview and reapply…' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Review layout changes' })).getByRole('button', {
        name: 'Apply layout',
      }),
    );
    expect(operations).toEqual(['presentation.layout.register', 'presentation.layout.apply']);
    expect(Number(screen.getByTestId('target-width').textContent)).toBe(400);
  });

  it('reports inherited versus locally changed layout state and resets one property', async () => {
    const user = userEvent.setup();
    const operations: string[] = [];
    render(<Harness operations={operations} />);
    await applyLayout(user);

    const overrides = screen.getByText(/Layout on “Opening”/).parentElement as HTMLElement;
    expect(overrides.textContent).toContain('Inherited');
    expect(overrides.textContent).toContain('applied revision');
    const resetAll = within(overrides).getByRole('button', { name: 'Reset all to layout' });
    expect(resetAll).toBeDisabled();
    expect(screen.getByTestId('has-binding').textContent).toBe('bound');

    await user.click(screen.getByTestId('move-title'));

    const changed = screen.getByText(/Layout on “Opening”/).parentElement as HTMLElement;
    expect(changed.textContent).toContain('Locally changed');
    const resetShape = within(changed).getByRole('button', {
      name: 'Reset shape of Slide title to the layout',
    });
    expect(resetShape).toBeTruthy();
    expect(within(changed).getByRole('button', { name: 'Reset all to layout' })).toBeEnabled();

    await user.click(resetShape);
    expect(operations).toContain('presentation.layout.overrides.reset');
    const restored = screen.getByText(/Layout on “Opening”/).parentElement as HTMLElement;
    expect(restored.textContent).toContain('Inherited');
    expect(restored.textContent).not.toContain('Locally changed');
  });

  it('detaching keeps the resolved artwork and only drops the binding', async () => {
    const user = userEvent.setup();
    const operations: string[] = [];
    render(<Harness operations={operations} />);
    await applyLayout(user);
    const widthBefore = screen.getByTestId('target-width').textContent;

    const overrides = screen.getByText(/Layout on “Opening”/).parentElement as HTMLElement;
    await user.click(
      within(overrides).getByRole('button', { name: 'Detach layout (keep appearance)' }),
    );

    expect(operations).toContain('presentation.layout.detach');
    expect(screen.getByTestId('has-binding').textContent).toBe('unbound');
    expect(screen.getByTestId('target-width').textContent).toBe(widthBefore);
    // The reusable source itself must survive detaching this one slide.
    expect(screen.getByTestId('layout-names').textContent).not.toBe('');
    expect(screen.queryByText(/Layout on “Opening”/)).toBeNull();
  });
});
