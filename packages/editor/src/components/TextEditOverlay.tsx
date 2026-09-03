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
  multiplyAffine,
} from '@varve/shared';
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../context';
import { nodeLocalBounds } from '../scene/world';

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
  /**
   * Called when editing completes (Escape or blur), with the textarea's final
   * value. The caller cannot read it from the node instead: the last
   * keystrokes are still in the coalescing buffer flushed just above, and the
   * scene update it schedules has not been applied yet.
   */
  onCommit: (finalText: string) => void;
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
  const pendingTextRef = useRef<string | null>(null);
  const updateTimerRef = useRef<number | null>(null);
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasActiveBurstRef = useRef(false);
  const onUpdateTextRef = useRef(onUpdateText);
  onUpdateTextRef.current = onUpdateText;
  const ctx = useEditor();
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const commitBurst = useCallback(() => {
    if (burstTimerRef.current !== null) {
      clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }
    if (hasActiveBurstRef.current) {
      hasActiveBurstRef.current = false;
      ctxRef.current.commitTransaction();
    }
  }, []);

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
  // Keep the editing affordance on the same local bounds used by selection,
  // hit testing, and the scene graph. This avoids a second single-line metric
  // implementation for wrapped and explicitly multi-line text.
  const localBounds = nodeLocalBounds(node);
  const w = localBounds?.w ?? node.w ?? Math.max((node.fontSize ?? 16) * 3, 20);
  const h = localBounds?.h ?? node.h ?? Math.max((node.fontSize ?? 16) * 1.4, 20);

  const notifyUpdate = useCallback((text: string) => {
    if (!hasActiveBurstRef.current) {
      hasActiveBurstRef.current = true;
      ctxRef.current.beginTransaction();
    }
    if (burstTimerRef.current !== null) clearTimeout(burstTimerRef.current);
    burstTimerRef.current = setTimeout(() => {
      burstTimerRef.current = null;
      hasActiveBurstRef.current = false;
      ctxRef.current.commitTransaction();
    }, 500);
    onUpdateTextRef.current(text);
  }, []);
  const notifyUpdateRef = useRef(notifyUpdate);
  notifyUpdateRef.current = notifyUpdate;

  const flushPendingText = useCallback(() => {
    const pending = pendingTextRef.current;
    pendingTextRef.current = null;
    if (updateTimerRef.current !== null) {
      window.clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    if (pending !== null) notifyUpdateRef.current(pending);
  }, []);

  const scheduleTextUpdate = useCallback((text: string) => {
    pendingTextRef.current = text;
    if (updateTimerRef.current !== null) return;
    // Text input can arrive much faster than the canvas can replay a large
    // document. Coalesce bursts and flush synchronously on blur/commit so the
    // model remains current without recursively rendering once per keystroke.
    updateTimerRef.current = window.setTimeout(() => {
      updateTimerRef.current = null;
      const pending = pendingTextRef.current;
      pendingTextRef.current = null;
      if (pending !== null) notifyUpdateRef.current(pending);
    }, 100);
  }, []);

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || composingRef.current) return;
    scheduleTextUpdate(ta.value);
  }, [scheduleTextUpdate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        flushPendingText();
        commitBurst();
        onCommit(textareaRef.current?.value ?? '');
      }
      // Enter inserts newline for multi-line text
    },
    [flushPendingText, commitBurst, onCommit],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    const ta = textareaRef.current;
    if (ta) {
      flushPendingText();
      notifyUpdateRef.current(ta.value);
    }
  }, [flushPendingText]);

  const handleBlur = useCallback(() => {
    if (!composingRef.current) {
      const finalText = textareaRef.current?.value ?? '';
      flushPendingText();
      commitBurst();
      onCommit(finalText);
    }
  }, [flushPendingText, commitBurst, onCommit]);

  useEffect(() => {
    return () => {
      if (updateTimerRef.current !== null) {
        window.clearTimeout(updateTimerRef.current);
      }
      updateTimerRef.current = null;
      pendingTextRef.current = null;
      if (burstTimerRef.current !== null) {
        clearTimeout(burstTimerRef.current);
        burstTimerRef.current = null;
      }
      if (hasActiveBurstRef.current) {
        hasActiveBurstRef.current = false;
        ctxRef.current.commitTransaction();
      }
    };
  }, []);

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
        // Keep the editing surface on the same fallback as shared text
        // geometry and the canvas renderer. Imported nodes may omit the
        // optional line-height field; using 1.2 here made their caret and
        // wrapped lines drift from the painted text.
        lineHeight: (node.lineHeight ?? 1.4).toString(),
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
