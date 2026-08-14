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

import type { Affine } from '@varve/engine';
import { createUnicodeIndexMap, normalizeGraphemeRange, utf16ToGrapheme } from '@varve/engine';
import type { RichSelection, TextNode } from '@varve/scene';
import {
  buildWorldToScreenAffine,
  computeFloatingOrigin,
  DEFAULT_ARTWORK_FONT_FAMILY,
  measureText,
  multiplyAffine,
} from '@varve/shared';
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../context';

interface TextEditOverlayProps {
  node: TextNode;
  zoom: number;
  pan: { x: number; y: number };
  /** View rotation in radians (non-destructive canvas rotate). Default 0. */
  cameraRotation?: number;
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
  cameraRotation,
  canvasElement,
  worldX,
  worldY,
  worldTransform,
  onCommit,
  onUpdateText,
}: TextEditOverlayProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const ctx = useEditor();

  // Compute screen-space position from world-space transform
  // Use pre-composed world coordinates when available (accounts for ancestor transforms).
  // Must go through worldToScreen + computeFloatingOrigin — the same transform
  // the canvas itself paints with (applyEditorCameraToCtx) — not hand-rolled
  // world*zoom+pan, which drifts from the painted position once panned away
  // from world (0,0) and puts this overlay somewhere else on screen than the
  // text it's supposed to be editing.
  const rect = canvasElement?.getBoundingClientRect();
  const canvasLeft = rect?.left ?? 0;
  const canvasTop = rect?.top ?? 0;
  const cam = { zoom, pan, rotation: cameraRotation ?? 0 };
  const viewport = { width: rect?.width ?? 1920, height: rect?.height ?? 1080 };
  const origin = computeFloatingOrigin(cam, viewport);
  const worldMatrix =
    worldTransform ??
    ([1, 0, 0, 1, worldX ?? node.transform[4], worldY ?? node.transform[5]] as Affine);
  const cameraMatrix = buildWorldToScreenAffine(cam, viewport, origin);
  const screenMatrix = multiplyAffine(cameraMatrix, worldMatrix);
  const cssMatrix: Affine = [
    screenMatrix[0],
    screenMatrix[1],
    screenMatrix[2],
    screenMatrix[3],
    screenMatrix[4] + canvasLeft,
    screenMatrix[5] + canvasTop,
  ];
  const textSize = measureText(node.text, {
    fontSize: node.fontSize ?? 16,
    fontFamily: node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
    fontWeight: node.fontWeight,
    fontStyle: node.fontStyle,
    letterSpacing: node.letterSpacing,
    lineHeight: node.lineHeight,
    textCase: node.textCase,
  });
  const w =
    node.w ?? Math.max(textSize.width, node.text.length === 0 ? (node.fontSize ?? 16) * 3 : 0);
  const h = node.h ?? textSize.height;

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

  // Report grapheme-aware caret position to editor state so the span editor
  // can apply formatting to the selected range. Maps UTF-16 textarea offsets
  // to codepoint grapheme boundaries for correct multi-codepoint handling.
  const handleSelect = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const text = ta.value;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const indexMap = createUnicodeIndexMap(text);
    const normalized = normalizeGraphemeRange(indexMap, start, end);
    const startOffset = utf16ToGrapheme(indexMap, normalized.start);
    const endOffset = utf16ToGrapheme(indexMap, normalized.end);
    const range: RichSelection = {
      start: { paragraphIndex: 0, offset: startOffset },
      end: { paragraphIndex: 0, offset: endOffset },
    };
    ctx.setSelectionRange(range);
  }, [ctx]);

  // Auto-focus on mount and select all text
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.select();
    }
  }, []);

  const editor = (
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
      onSelect={handleSelect}
      dir="auto"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: Math.max(w, 20),
        height: Math.max(h, 20),
        fontSize: node.fontSize ?? 16,
        fontFamily: node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
        fontWeight: node.fontWeight ?? 400,
        lineHeight: (node.lineHeight ?? 1.2).toString(),
        letterSpacing: `${node.letterSpacing ?? 0}px`,
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
        transform: `matrix(${cssMatrix.join(',')})`,
        transformOrigin: '0 0',
        zIndex: 1000,
      }}
    />
  );
  return createPortal(editor, document.body);
}
