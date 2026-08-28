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
  const { createDocument, makeShapeNode, addChild } = await import('@varve/scene');
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

/** Same as the rect helper, but selects a frame to verify screen selection. */
async function renderPanelWithSelectedFrame() {
  const { createDocument, makeFrameNode, addChild } = await import('@varve/scene');
  let doc = createDocument('frame-selection-test');
  const frame = makeFrameNode('f1', { name: 'Frame1', transform: [1, 0, 0, 1, 0, 0] });
  doc = addChild(doc, doc.pages?.[0]?.contentRoot as string, frame);

  let ctx: ReturnType<typeof useEditor> | undefined;
  function Selector() {
    ctx = useEditor();
    React.useEffect(() => {
      ctx?.setSelection('f1');
    }, []);
    return null;
  }

  const utils = render(
    <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
      <Selector />
      <PropertiesPanel />
    </EditorProvider>,
  );
  await waitFor(() => expect(ctx?.state.selection).toEqual(['f1']));
  return utils;
}

describe('PropertiesPanel canvas settings', () => {
  it('uses the grouped workspace tabs and omits legacy document and spec tabs', () => {
    renderPanel();

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent?.trim());
    const tabLabels = tabs.filter(Boolean);
    // Prototype and Fonts are contextual — they appear for a frame and a text
    // selection respectively, so an empty selection shows neither.
    expect(tabLabels).toEqual(['Properties', 'Appearance', 'Export', 'Audit']);
    expect(screen.queryByRole('tab', { name: 'Prototype' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Fonts' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Document' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Inspect' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Score' })).toBeNull();
  });

  it('implements APG roving focus for arrow, Home, and End keys across the tab row', () => {
    renderPanel();
    // Derived from what actually renders: the tab row is contextual, and the
    // roving-focus contract applies to whichever tabs are present.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    const first = tabs[0]!;
    const second = tabs[1]!;
    const third = tabs[2]!;
    const last = tabs[tabs.length - 1]!;

    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowRight' });
    expect(third).toHaveFocus();

    fireEvent.keyDown(third, { key: 'End' });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Home' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(last).toHaveFocus();
  });

  it('renders canvas settings inline in the Properties empty state', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Canvas' })).toBeTruthy();
    expect(await screen.findByText(/^Background$/)).toBeTruthy();
  });

  it('renders real document colour settings without exposing storage-root node counts', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: 'RGB' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'CMYK' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Grayscale' })).toBeTruthy();
    expect(screen.queryByText(/nodes?/i)).toBeNull();
  });
});

describe('PropertiesPanel section gating for a real single selection', () => {
  it('exposes live Boolean Pathfinder operation, operand isolation, and expansion controls', async () => {
    const { addChild, createDocument, createLiveBooleanDoc, makeShapeNode } = await import(
      '@varve/scene'
    );
    let doc = createDocument('pathfinder-test');
    const first = makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    const second = makeShapeNode('b', { kind: 'rect', x: 25, y: 25, w: 50, h: 50 });
    doc = addChild(doc, doc.pages?.[0]?.contentRoot as string, first);
    doc = addChild(doc, doc.pages?.[0]?.contentRoot as string, second);
    const live = createLiveBooleanDoc(doc, ['a', 'b'], 'union');
    expect(live).not.toBeNull();
    if (!live) return;

    let ctx: ReturnType<typeof useEditor> | undefined;
    function Selector() {
      ctx = useEditor();
      React.useEffect(() => {
        ctx?.setSelection(live.nodeId);
      }, []);
      return null;
    }

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(live.doc)}>
        <Selector />
        <PropertiesPanel />
      </EditorProvider>,
    );

    await waitFor(() => expect(ctx?.state.selection).toEqual([live.nodeId]));
    expect(screen.getByRole('button', { name: 'Pathfinder' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Boolean operation' })).toHaveValue('union');
    expect(screen.getByRole('button', { name: /Edit operand 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Edit operand 2/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Boolean operands' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand Boolean' })).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Boolean operation' }), {
      target: { value: 'subtract' },
    });
    await waitFor(() =>
      expect(ctx?.state.document.nodes[live.nodeId]).toMatchObject({
        boolean: { operation: 'subtract' },
      }),
    );
  });

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

  it('shows Prototype for a selected frame screen', async () => {
    await renderPanelWithSelectedFrame();
    expect(screen.getByRole('tab', { name: 'Prototype' })).toBeTruthy();
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
    const { makeShapeNode, addChild, createDocument } = await import('@varve/scene');
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

describe('PropertiesPanel export sub-tabs keyboard', () => {
  it('uses roving tabindex and arrow keys with automatic activation', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Export' }));
    const formatTab = screen.getByRole('tab', { name: 'Format' });
    const codeTab = screen.getByRole('tab', { name: 'Code' });

    // Roving: only the active sub-tab is in the tab order.
    expect(formatTab).toHaveAttribute('tabindex', '0');
    expect(codeTab).toHaveAttribute('tabindex', '-1');

    // ArrowRight activates and focuses Code; roving index follows.
    fireEvent.keyDown(formatTab, { key: 'ArrowRight' });
    expect(codeTab).toHaveAttribute('tabindex', '0');
    expect(formatTab).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText(/Select a node to export/i)).toBeTruthy();

    // ArrowLeft wraps back to Format.
    fireEvent.keyDown(codeTab, { key: 'ArrowLeft' });
    expect(formatTab).toHaveAttribute('tabindex', '0');
  });

  it('Home/End jump to first/last sub-tab', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Export' }));
    const formatTab = screen.getByRole('tab', { name: 'Format' });
    const codeTab = screen.getByRole('tab', { name: 'Code' });

    fireEvent.keyDown(formatTab, { key: 'End' });
    expect(codeTab).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(codeTab, { key: 'Home' });
    expect(formatTab).toHaveAttribute('tabindex', '0');
  });
});
