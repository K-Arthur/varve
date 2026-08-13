// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDocument, type Document, type FrameNode, type TextNode } from '@varve/scene';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../context';
import { IntelligencePanel } from './IntelligencePanel';

/** Selects the given node on mount — IntelligencePanel has no selection UI
 * of its own, so tests need a way to establish selection state before
 * exercising selection-dependent tabs (e.g. Naming). */
function WithSelection({ id, children }: { id: string; children: React.ReactNode }) {
  const { setSelection } = useEditor();
  // Mount-only: setSelection/patch return a new context value each render,
  // so depending on setSelection here would re-fire every render and loop.
  useEffect(() => {
    setSelection(id);
  }, [id]);
  return <>{children}</>;
}

function lowContrastDocument(): Document {
  const frame: FrameNode = {
    id: 'frame1',
    kind: 'frame',
    name: 'Card',
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
    children: ['text1'],
    strokes: [],
    effects: [],
    w: 400,
    h: 200,
  } as FrameNode;
  const text: TextNode = {
    id: 'text1',
    kind: 'text',
    name: 'Caption',
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 204, g: 204, b: 204, a: 255 },
    text: 'Hello',
    fontSize: 16,
    strokes: [],
    effects: [],
  } as TextNode;
  return {
    ...createDocument('audit-panel-test'),
    nodes: { frame1: frame, text1: text },
    rootChildren: ['frame1'],
  };
}

describe('IntelligencePanel — Audit tab', () => {
  function switchToAuditTab() {
    const auditTab = screen.getByRole('tab', { name: /audit/i });
    fireEvent.click(auditTab);
  }

  it('shows "no issues" for a document with no contrast problems', () => {
    render(
      <EditorProvider>
        <IntelligencePanel />
      </EditorProvider>,
    );
    switchToAuditTab();
    expect(screen.getByText('No issues detected')).toBeInTheDocument();
  });

  it('surfaces a real contrast issue and offers select + auto-fix', () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(lowContrastDocument())}>
        <IntelligencePanel />
      </EditorProvider>,
    );
    switchToAuditTab();
    expect(screen.queryByText('No issues detected')).not.toBeInTheDocument();
    expect(screen.getByText(/WCAG AA minimum/i)).toBeInTheDocument();

    const autoFix = screen.getByRole('button', { name: /auto-fix/i });
    fireEvent.click(autoFix);
    expect(screen.getByText('No issues detected')).toBeInTheDocument();
  });
});

describe('IntelligencePanel — Naming tab', () => {
  it('suggests names for a non-image selection without touching the classification model', async () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(lowContrastDocument())}>
        <WithSelection id="text1">
          <IntelligencePanel initialTab="naming" />
        </WithSelection>
      </EditorProvider>,
    );

    const suggestBtn = await screen.findByRole('button', { name: /suggest names/i });
    expect(suggestBtn).not.toBeDisabled();
    fireEvent.click(suggestBtn);

    // The async image-classification pre-pass should resolve immediately
    // (no image nodes in the selection) without ever showing a download or
    // classifying state, landing straight on the suggestion list.
    await waitFor(() => expect(screen.getByText('Text: Hello')).toBeInTheDocument());
    expect(screen.queryByText(/identifying photo content/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/downloading photo-identification model/i)).not.toBeInTheDocument();
  });
});

describe('IntelligencePanel — Similar tab', () => {
  it('offers a text query when nothing is selected', () => {
    render(
      <EditorProvider>
        <IntelligencePanel initialTab="similar" />
      </EditorProvider>,
    );
    expect(screen.getByLabelText(/describe an asset/i)).toBeInTheDocument();
    expect(screen.getByText(/select an image or enter a description/i)).toBeInTheDocument();
  });

  it('keeps natural-language search available when a non-image node is selected', () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(lowContrastDocument())}>
        <IntelligencePanel initialTab="similar" />
      </EditorProvider>,
    );
    expect(screen.getByLabelText(/describe an asset/i)).toBeInTheDocument();
    expect(screen.getByText(/select an image or enter a description/i)).toBeInTheDocument();
  });
});
