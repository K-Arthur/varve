// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  createDocument,
  DEFAULT_BLEED,
  type Document,
  defaultCmykColorConfig,
  type ShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../context';
import { PreflightWarnings } from './PreflightWarnings';

// The component uses useEditor() which throws if not within EditorProvider.
describe('PreflightWarnings', () => {
  it('renders null when no editor context (throws without provider)', () => {
    expect(() => render(<PreflightWarnings />)).toThrow('useEditor');
  });

  it('shows a clean badge and lists unavailable checks for a print-ready document', () => {
    const doc: Document = {
      ...createDocument('print-ready'),
      colorConfig: defaultCmykColorConfig(),
      documentUnit: 'mm',
      physicalWidth: 210,
      physicalHeight: 297,
      dpi: 300,
      bleed: { ...DEFAULT_BLEED },
    };
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
        <PreflightWarnings />
      </EditorProvider>,
    );
    const badge = screen.getByRole('button', { name: /no issues found/i });
    expect(badge).toBeInTheDocument();

    fireEvent.click(badge);
    expect(screen.getByText(/no issues found in the checks below/i)).toBeInTheDocument();
    expect(screen.getByText('Overset text')).toBeInTheDocument();
    expect(screen.getByText('Printable-area violations')).toBeInTheDocument();
  });

  it('shows a warning badge and the bleed error for a document with no bleed configured', () => {
    const doc: Document = {
      ...createDocument('no-bleed'),
      colorConfig: defaultCmykColorConfig(),
      dpi: 300,
      bleed: undefined,
    };
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
        <PreflightWarnings />
      </EditorProvider>,
    );
    const badge = screen.getByRole('button', { name: /errors/i });
    expect(badge).toBeInTheDocument();

    fireEvent.click(badge);
    expect(screen.getByText(/no bleed configured/i)).toBeInTheDocument();
  });

  it('navigates to the offending node and closes the panel when Select is clicked', () => {
    const rgbRect: ShapeNode = {
      id: 'rect1',
      kind: 'shape',
      name: 'RGB Rectangle',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      strokes: [],
      effects: [],
    };
    const doc: Document = {
      ...createDocument('rgb-in-cmyk'),
      colorConfig: defaultCmykColorConfig(),
      dpi: 300,
      bleed: { ...DEFAULT_BLEED },
      nodes: { rect1: rgbRect },
    };
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
        <PreflightWarnings />
      </EditorProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /warnings/i }));
    const selectBtn = screen.getByRole('button', { name: /select node rect1/i });
    fireEvent.click(selectBtn);
    expect(screen.queryByRole('dialog', { name: /preflight issues/i })).not.toBeInTheDocument();
  });
});
