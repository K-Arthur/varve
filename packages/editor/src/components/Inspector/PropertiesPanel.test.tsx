// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { PropertiesPanel } from './PropertiesPanel';

function renderPanel() {
  return render(
    <EditorProvider>
      <PropertiesPanel />
    </EditorProvider>,
  );
}

/** Renders PropertiesPanel with one real rect node selected via the actual
 * editor context (not a mocked useEditor), so section-registry gating runs
 * through its real call path rather than being bypassed by a test double. */
async function renderPanelWithSelectedRect() {
  const { createDocument, makeShapeNode, addChild } = await import('@strata/scene');
  let doc = createDocument('selection-test');
  const rect = makeShapeNode(
    'r1',
    { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    { name: 'Rect1', transform: [1, 0, 0, 1, 0, 0] },
  );
  doc = addChild(doc, doc.pages?.[0]?.contentRoot as string, rect);

  let ctx: ReturnType<typeof useEditor> | undefined;
  function Selector() {
    ctx = useEditor();
    React.useEffect(() => {
      ctx?.setSelection('r1');
    }, []);
    return null;
  }

  const utils = render(
    <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
      <Selector />
      <PropertiesPanel />
    </EditorProvider>,
  );
  await waitFor(() => expect(ctx?.state.selection).toEqual(['r1']));
  return utils;
}

describe('PropertiesPanel canvas settings', () => {
  it('renders empty-state canvas and document color sections', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Canvas' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Document Color' })).toBeTruthy();
    expect(screen.getByLabelText('Canvas background')).toBeTruthy();

    expect(screen.getByRole('button', { name: 'RGB' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'CMYK' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Grayscale' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('switches document color mode via the mode buttons', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'CMYK' }));

    expect(screen.getByRole('button', { name: 'CMYK' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'RGB' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Grayscale' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('PropertiesPanel section gating for a real single selection', () => {
  it('shows Prototype Interactions for a plain selection outside prototypeMode', async () => {
    // Regression test: the section registry previously required
    // ctx.prototypeMode to be true for this section, but nothing in the app
    // ever sets prototypeMode — that made "Prototype Interactions" completely
    // unreachable. It must render for any ordinary single selection.
    await renderPanelWithSelectedRect();
    expect(screen.getByRole('button', { name: 'Prototype Interactions' })).toBeTruthy();
  });

  it('does not mount image-only AI sections for a non-image rect selection', async () => {
    await renderPanelWithSelectedRect();
    for (const title of ['AI Denoise', 'Lens Blur', 'Line Art', 'Blend Images']) {
      expect(screen.queryByRole('button', { name: title })).toBeNull();
    }
  });
});
