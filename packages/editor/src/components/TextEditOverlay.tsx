/**
 * TextEditOverlay — inline text editing via positioned <textarea>.
 *
 * Renders a transparent-text <textarea> overlaid on the canvas at the text
 * node's screen-space position. The textarea mirrors its content back to the
 * scene model on every input event, providing undo-coherent keystroke batching.
 *
 * Research basis: Figma inline text editing (double-click → contentEditable),
 * APG textbox pattern, CJK IME composition lifecycle.
 */

import type { Affine } from '@strata/engine';
import type { TextNode } from '@strata/scene';
import { measureText } from '@strata/shared';
import { useCallback, useEffect, useRef } from 'react';

interface TextEditOverlayProps {
  node: TextNode;
  zoom: number;
  pan: { x: number; y: number };
  canvasElement: HTMLCanvasElement | null;
  /** Pre-composed world-space X (accounts for ancestor transforms). */
  worldX?: number;
  /** Pre-composed world-space Y (accounts for ancestor transforms). */
  worldY?: number;
  /** Pre-composed world transform matrix. */
  worldTransform?: Affine;
  /** Called when editing completes (Escape or blur). */
  onCommit: () => void;
  /** Called when content changes. */
  onUpdateText: (text: string) => void;
}

export function TextEditOverlay({
  node,
  zoom,
  pan,
  canvasElement,
  worldX,
  worldY,
  onCommit,
  onUpdateText,
}: TextEditOverlayProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // Compute screen-space position from world-space transform
  // Use pre-composed world coordinates when available (accounts for ancestor transforms)
  const rect = canvasElement?.getBoundingClientRect();
  const canvasLeft = rect?.left ?? 0;
  const canvasTop = rect?.top ?? 0;
  const wx = worldX ?? node.transform[4];
  const wy = worldY ?? node.transform[5];
  const x = wx * zoom + pan.x + canvasLeft;
  const y = wy * zoom + pan.y + canvasTop;
  const textSize = measureText(node.text, {
    fontSize: node.fontSize ?? 16,
    fontFamily: node.fontFamily ?? 'Inter',
    fontWeight: node.fontWeight,
    fontStyle: node.fontStyle,
    letterSpacing: node.letterSpacing,
    lineHeight: node.lineHeight,
    textCase: node.textCase,
  });
  const w = Math.max(textSize.width, node.text.length === 0 ? (node.fontSize ?? 16) * 3 : 0) * zoom;
  const h = textSize.height * zoom;

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || composingRef.current) return;
    onUpdateText(ta.value);
  }, [onUpdateText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCommit();
      }
      // Enter inserts newline for multi-line text
    },
    [onCommit],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    const ta = textareaRef.current;
    if (ta) {
      onUpdateText(ta.value);
    }
  }, [onUpdateText]);

  const handleBlur = useCallback(() => {
    if (!composingRef.current) {
      onCommit();
    }
  }, [onCommit]);

  // Auto-focus on mount and select all text
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.select();
    }
  }, []);

  return (
    <textarea
      ref={textareaRef}
      defaultValue={node.text}
      aria-label={`Editing text: ${node.name}`}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionUpdate={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onBlur={handleBlur}
      dir="auto"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        width: Math.max(w, 20),
        minHeight: Math.max(h, 20),
        fontSize: (node.fontSize ?? 16) * zoom,
        fontFamily: node.fontFamily ?? 'Inter',
        fontWeight: node.fontWeight ?? 400,
        lineHeight: (node.lineHeight ?? 1.2).toString(),
        letterSpacing: `${(node.letterSpacing ?? 0) * zoom}px`,
        padding: 0,
        margin: 0,
        border: '1px solid var(--color-interactive-default, #3b82f6)',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        background: 'transparent',
        color: 'transparent',
        caretColor: 'var(--color-interactive-default, #3b82f6)',
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',
        zIndex: 1000,
      }}
    />
  );
}
