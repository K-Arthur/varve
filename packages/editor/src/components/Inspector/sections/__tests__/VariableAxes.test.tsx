// @vitest-environment jsdom

/**
 * Variable-font axis controls in the typography inspector.
 *
 * This panel renders nothing unless the selected family reports as variable,
 * which no bundled family did until the registry learned their fvar axes —
 * so the whole surface was unreachable in the shipping application.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDocument, type TextNode } from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../../context';
import { TypographySection } from '../TypographySection';

afterEach(cleanup);

function textNode(fontFamily: string, variableAxes?: Record<string, number>): TextNode {
  return {
    id: 't1',
    kind: 'text',
    name: 'Specimen',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
    text: 'Aa',
    transform: [1, 0, 0, 1, 0, 0] as const,
    w: 400,
    h: 120,
    fill: { space: 'rgb', r: 16, g: 21, b: 31, a: 255 },
    fontSize: 96,
    fontFamily,
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: 1.1,
    letterSpacing: 0,
    textAlign: 'left',
    direction: 'auto',
    strokes: [],
    effects: [],
    ...(variableAxes ? { variableAxes } : {}),
  } as TextNode;
}

const renderFor = (node: TextNode) =>
  render(
    <EditorProvider>
      <TypographySection nodes={[node]} />
    </EditorProvider>,
  );

/**
 * Renders the section against the live document node, the way
 * PropertiesPanel does, so edits round-trip instead of being swallowed by a
 * stale prop.
 */
function renderLive(node: TextNode) {
  const doc = createDocument('specimen', true);
  doc.nodes[node.id] = node;
  doc.rootChildren.push(node.id);

  function Live() {
    const { state } = useEditor();
    const live = state.document.nodes[node.id] as TextNode | undefined;
    return live ? <TypographySection nodes={[live]} /> : null;
  }

  return render(
    <EditorProvider initialDocumentJson={JSON.stringify(doc)}>
      <Live />
    </EditorProvider>,
  );
}

const slider = () => screen.getByLabelText('Weight (wght)') as HTMLInputElement;

describe('variable font axes panel', () => {
  it('offers the axes of a bundled variable family', () => {
    renderFor(textNode('Geist Variable'));
    expect(screen.getByLabelText('Weight (wght)')).toBeTruthy();
  });

  it('spans the range the font declares, not a generic one', () => {
    renderFor(textNode('Geist Variable'));
    expect(slider().min).toBe('100');
    expect(slider().max).toBe('900');
  });

  it('honours a narrower range on a family that has one', () => {
    renderFor(textNode('IBM Plex Sans Variable'));
    // IBM Plex Sans stops at 700; the generic table would have said 1000.
    expect(slider().max).toBe('700');
  });

  it('shows every axis a multi-axis family declares', () => {
    renderFor(textNode('Fraunces Variable'));
    expect(screen.getByLabelText('Optical Size (opsz)')).toBeTruthy();
    expect(screen.getByLabelText('Weight (wght)')).toBeTruthy();
  });

  it('omits axes the family does not vary', () => {
    renderFor(textNode('Geist Variable'));
    // Geist varies weight only; a generic axis list would have offered these.
    expect(screen.queryByLabelText(/Optical Size/)).toBeNull();
    expect(screen.queryByLabelText(/Slant/)).toBeNull();
  });

  it('renders nothing for a static family', () => {
    renderFor(textNode('Georgia'));
    expect(screen.queryByLabelText(/Weight \(wght\)/)).toBeNull();
  });

  it('starts each axis at the font default', () => {
    renderFor(textNode('Fraunces Variable'));
    expect((screen.getByLabelText('Optical Size (opsz)') as HTMLInputElement).value).toBe('9');
  });

  it('reflects an axis value already set on the node', () => {
    renderFor(textNode('Geist Variable', { wght: 750 }));
    expect(slider().value).toBe('750');
  });

  it('steps integrally over a wide axis rather than in fractions', () => {
    renderFor(textNode('Geist Variable'));
    expect(slider().step).toBe('1');
  });

  it('disables reset while the axis sits at its default', () => {
    renderFor(textNode('Geist Variable'));
    expect(screen.getByLabelText('Reset Weight to default').hasAttribute('disabled')).toBe(true);
  });

  it('enables reset once the axis has moved', () => {
    renderFor(textNode('Geist Variable', { wght: 750 }));
    expect(screen.getByLabelText('Reset Weight to default').hasAttribute('disabled')).toBe(false);
  });

  it('survives a selection moving between variable and static families', () => {
    // The axis callbacks used to be declared after the not-variable early
    // return, so this transition changed the hook count mid-render.
    const { rerender } = render(
      <EditorProvider>
        <TypographySection nodes={[textNode('Geist Variable')]} />
      </EditorProvider>,
    );
    expect(() =>
      rerender(
        <EditorProvider>
          <TypographySection nodes={[textNode('Georgia')]} />
        </EditorProvider>,
      ),
    ).not.toThrow();
  });

  it('writes the dragged value onto the node in the document', () => {
    renderLive(textNode('Geist Variable'));
    fireEvent.change(slider(), { target: { value: '800' } });
    expect(slider().value).toBe('800');
    expect(screen.getByLabelText('Reset Weight to default').hasAttribute('disabled')).toBe(false);
  });

  it('clears an axis back to the font default on reset', () => {
    renderLive(textNode('Geist Variable', { wght: 800 }));
    fireEvent.click(screen.getByLabelText('Reset Weight to default'));
    expect(slider().value).toBe('400');
  });
});
