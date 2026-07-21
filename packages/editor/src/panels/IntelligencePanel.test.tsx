// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { createDocument, type Document, type FrameNode, type TextNode } from '@strata/scene';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../context';
import { IntelligencePanel } from './IntelligencePanel';

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
  it('shows "no issues" for a document with no contrast problems', () => {
    render(
      <EditorProvider>
        <IntelligencePanel />
      </EditorProvider>,
    );
    expect(screen.getByText('No issues detected')).toBeInTheDocument();
  });

  it('surfaces a real contrast issue and offers select + auto-fix', () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(lowContrastDocument())}>
        <IntelligencePanel />
      </EditorProvider>,
    );
    expect(screen.queryByText('No issues detected')).not.toBeInTheDocument();
    expect(screen.getByText(/WCAG AA minimum/i)).toBeInTheDocument();

    const autoFix = screen.getByRole('button', { name: /auto-fix/i });
    fireEvent.click(autoFix);
    expect(screen.getByText('No issues detected')).toBeInTheDocument();
  });
});

describe('IntelligencePanel — Similar tab', () => {
  it('prompts to select an image when nothing is selected', () => {
    render(
      <EditorProvider>
        <IntelligencePanel initialTab="similar" />
      </EditorProvider>,
    );
    expect(
      screen.getByText(/select an image to find visually similar images/i),
    ).toBeInTheDocument();
  });

  it('prompts to select an image when a non-image node is selected', () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(lowContrastDocument())}>
        <IntelligencePanel initialTab="similar" />
      </EditorProvider>,
    );
    expect(
      screen.getByText(/select an image to find visually similar images/i),
    ).toBeInTheDocument();
  });
});
