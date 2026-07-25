// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { PropertiesPanel } from './PropertiesPanel';

function renderPanel() {
  // Mock clientWidth so the overflow logic doesn't trigger in jsdom
  // (jsdom has no layout engine, so clientWidth defaults to 0, which would
  // cause all movable tabs to overflow and prevent tab switching).
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: 800,
  });
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
  it('uses the grouped workspace tabs and omits legacy document and spec tabs', () => {
    renderPanel();

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent?.trim());
    const tabLabels = tabs.filter(Boolean);
    expect(tabLabels).toEqual([
      'Properties',
      'Appearance & Effects',
      'Prototype',
      'Export',
      'Audit',
    ]);
    expect(screen.queryByRole('tab', { name: 'Document' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Inspect' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Score' })).toBeNull();
  });

  it('implements APG roving focus for arrow, Home, and End keys within each tier', () => {
    renderPanel();
    const appearance = screen.getByRole('tab', { name: 'Appearance & Effects' });
    const audit = screen.getByRole('tab', { name: 'Audit' });

    appearance.focus();
    fireEvent.keyDown(appearance, { key: 'ArrowRight' });
    const prototype = screen.getByRole('tab', { name: 'Prototype' });
    expect(prototype).toHaveFocus();

    fireEvent.keyDown(prototype, { key: 'End' });
    expect(audit).toHaveFocus();

    fireEvent.keyDown(audit, { key: 'Home' });
    expect(appearance).toHaveFocus();

    fireEvent.keyDown(appearance, { key: 'ArrowLeft' });
    expect(audit).toHaveFocus();
  });

  it('renders canvas settings inline in the Properties empty state', async () => {
    renderPanel();
    expect(screen.getByText(/Canvas background/i)).toBeTruthy();
  });

  it('renders the document name and node count in the Properties empty state', async () => {
    renderPanel();
    expect(screen.getByText(/^Untitled$/)).toBeTruthy();
    expect(screen.getByText(/nodes?/)).toBeTruthy();
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

describe('PropertiesPanel export tab has merged export and code', () => {
  it('renders the export tab with Format and Code sub-tabs when a node is selected', async () => {
    const { makeShapeNode, addChild, createDocument } = await import('@strata/scene');
    let doc = createDocument('export-test');
    const rect = makeShapeNode('r1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    doc = addChild(doc, doc.pages?.[0]?.contentRoot as string, rect);

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
        <PropertiesPanel />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Export' }));
    expect(screen.getByRole('tab', { name: 'Format' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Code' })).toBeTruthy();
  });

  it('shows the empty state hint in the Export tab when nothing is selected', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Export' }));
    expect(screen.getByText(/Select a node to export/i)).toBeTruthy();
  });
});

describe('PropertiesPanel empty selection', () => {
  it('does not render the State Machine section inline', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'State Machine' })).toBeNull();
  });
});
