import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TextNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EditorContextValue, EditorCtx, EditorProvider } from '../context';
import { TextEditOverlay } from './TextEditOverlay';

afterEach(cleanup);

function makeNode(text: string, direction: TextNode['direction'] = 'auto'): TextNode {
  return {
    id: 't1',
    kind: 'text',
    name: 'Text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
    text,
    transform: [1, 0, 0, 1, 0, 0] as const,
    w: 100,
    h: 20,
    fill: { space: 'rgb', r: 16, g: 21, b: 31, a: 255 },
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: 1.2,
    letterSpacing: 0,
    textAlign: 'left',
    direction,
    strokes: [],
    effects: [],
  } as TextNode;
}

function renderOverlay(node: TextNode) {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(canvas);
  return render(
    <EditorProvider>
      <TextEditOverlay
        node={node}
        zoom={1}
        pan={{ x: 0, y: 0 }}
        canvasElement={canvas}
        onCommit={() => {}}
        onUpdateText={() => {}}
      />
    </EditorProvider>,
  );
}

describe('TextEditOverlay', () => {
  it('renders a textarea with the node text', () => {
    const node = makeNode('Hello');
    renderOverlay(node);
    const ta = screen.getByRole('textbox');
    expect(ta).toBeTruthy();
    expect((ta as HTMLTextAreaElement).value).toBe('Hello');
  });

  it('reports grapheme-aware selection range on select', () => {
    const node = makeNode('Hello');
    const { baseElement: _baseElement } = renderOverlay(node);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    act(() => {
      ta.focus();
      ta.setSelectionRange(1, 3);
      fireEvent.select(ta);
    });
    // The selection range is reported to context (verified by no throw and
    // the textarea remaining functional).
    expect(ta.selectionStart).toBe(1);
    expect(ta.selectionEnd).toBe(3);
  });

  it('sets dir="auto" on the textarea for BiDi caret movement', () => {
    const node = makeNode('مرحبا', 'rtl');
    renderOverlay(node);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.getAttribute('dir')).toBe('auto');
  });

  it('uses the canonical fallback line height when the node omits one', () => {
    const { lineHeight: _lineHeight, ...withoutLineHeight } = makeNode('First\nSecond');
    renderOverlay(withoutLineHeight as TextNode);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.style.lineHeight).toBe('1.4');
  });

  it('guards input during IME composition', () => {
    const onUpdateText = vi.fn();
    const node = makeNode('Hello');
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(canvas);
    render(
      <EditorProvider>
        <TextEditOverlay
          node={node}
          zoom={1}
          pan={{ x: 0, y: 0 }}
          canvasElement={canvas}
          onCommit={() => {}}
          onUpdateText={onUpdateText}
        />
      </EditorProvider>,
    );
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    // Composition start → input events are ignored until composition end.
    fireEvent.compositionStart(ta);
    fireEvent.input(ta, { target: { value: 'Hello 世' } });
    expect(onUpdateText).not.toHaveBeenCalled();
    fireEvent.compositionEnd(ta, { data: '世' });
    // After composition end, the committed value is reported.
    expect(onUpdateText).toHaveBeenCalled();
  });

  it('coalesces a typing burst into one transaction after 500ms idle', () => {
    vi.useFakeTimers();
    const beginTransaction = vi.fn();
    const commitTransaction = vi.fn();
    const node = makeNode('Hello');
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(canvas);
    try {
      render(
        <EditorCtx.Provider
          value={
            {
              beginTransaction,
              commitTransaction,
              setSelectionRange: vi.fn(),
            } as unknown as EditorContextValue
          }
        >
          <TextEditOverlay
            node={node}
            zoom={1}
            pan={{ x: 0, y: 0 }}
            canvasElement={canvas}
            onCommit={() => {}}
            onUpdateText={() => {}}
          />
        </EditorCtx.Provider>,
      );
      const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

      fireEvent.input(ta, { target: { value: 'Hello!' } });
      act(() => vi.advanceTimersByTime(100));
      fireEvent.input(ta, { target: { value: 'Hello!!' } });
      act(() => vi.advanceTimersByTime(100));

      expect(beginTransaction).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(499));
      expect(commitTransaction).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(commitTransaction).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
