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
async function renderPanelWithSelectedRect(locked = false) {
  const { createDocument, makeShapeNode, addChild } = await import('@strata/scene');
  let doc = createDocument('selection-test');
  const rect = makeShapeNode(
    'r1',
    { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    { name: 'Rect1', transform: [1, 0, 0, 1, 0, 0], locked },
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
  it('uses the workspace ownership tabs and omits the duplicate Score tab', () => {
    renderPanel();

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual([
      'Properties',
      'Appearance',
      'Prototype',
      'Document',
      'Export',
      'Inspect',
      'Audit',
    ]);
    expect(screen.queryByRole('tab', { name: 'Score' })).toBeNull();
  });

  it('implements APG roving focus for arrow, Home, and End keys', () => {
    renderPanel();
    const properties = screen.getByRole('tab', { name: 'Properties' });
    const appearance = screen.getByRole('tab', { name: 'Appearance' });
    const audit = screen.getByRole('tab', { name: 'Audit' });

    properties.focus();
    fireEvent.keyDown(properties, { key: 'ArrowRight' });
    expect(appearance).toHaveFocus();
    expect(appearance).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(appearance, { key: 'End' });
    expect(audit).toHaveFocus();

    fireEvent.keyDown(audit, { key: 'Home' });
    expect(properties).toHaveFocus();
  });

  it('renders canvas and document color settings on the Document surface', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Document' }));

    expect(await screen.findByRole('button', { name: 'Canvas' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Document Color' })).toBeTruthy();
    expect(screen.getByLabelText('Canvas background')).toBeTruthy();

    expect(screen.getByRole('button', { name: 'RGB' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'CMYK' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Grayscale' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('switches document color mode via the Document surface', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Document' }));

    fireEvent.click(await screen.findByRole('button', { name: 'CMYK' }));

    expect(screen.getByRole('button', { name: 'CMYK' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'RGB' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Grayscale' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('PropertiesPanel section gating for a real single selection', () => {
  it('makes selection workflows read-only when any selected node is locked', async () => {
    await renderPanelWithSelectedRect(true);

    expect(screen.getByText(/selection is locked/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Position & Size' }).closest('[inert]')).toBeTruthy();
  });

  it('honors section-manager visibility for optional Properties sections', async () => {
    await renderPanelWithSelectedRect();
    expect(screen.getByRole('button', { name: 'Corner Radius' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Customize sections' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Corner Radius' }));

    expect(screen.queryByRole('button', { name: 'Corner Radius' })).toBeNull();
  });

  it('moves Prototype Interactions to the dedicated Prototype surface', async () => {
    await renderPanelWithSelectedRect();
    expect(screen.queryByRole('button', { name: 'Prototype Interactions' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Prototype' }));
    expect(await screen.findByRole('button', { name: 'Prototype Interactions' })).toBeTruthy();
  });

  it('does not mount image-only AI sections for a non-image rect selection', async () => {
    await renderPanelWithSelectedRect();
    for (const title of ['AI Denoise', 'Lens Blur', 'Line Art', 'Blend Images']) {
      expect(screen.queryByRole('button', { name: title })).toBeNull();
    }
  });

  it('does not render the State Machine section inline (moved to its own panel)', async () => {
    // State machines are document-wide (document.stateMachines), not tied to
    // the current selection — it previously rendered unconditionally at the
    // bottom of every properties-tab view regardless of selection. It now
    // lives in its own dialog, opened via toggleStateMachinePanel.
    await renderPanelWithSelectedRect();
    expect(screen.queryByRole('button', { name: 'State Machine' })).toBeNull();
  });
});

describe('PropertiesPanel empty selection', () => {
  it('does not render the State Machine section inline', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'State Machine' })).toBeNull();
  });
});
