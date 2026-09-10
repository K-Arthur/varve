/**
 * RichTextSpanEditor — inline span editor for rich-text runs.
 *
 * Renders each run as an inline editable span with its own CharacterFormat.
 * On selection change within the editor, formatting controls (bold, italic,
 * color, size) apply to the selected range via context.applyFormatToSelection.
 * Adjacent runs with identical format are merged on blur.
 *
 * Research basis: Figma multi-run text editing, ARIA textbox + activedescendant.
 */

import type { CharacterFormat, ManagedColor, RichSelection, RichText, TextRun } from '@varve/scene';
import { applyFormatToSelection, characterFormatValue, mergeAdjacentRuns } from '@varve/scene';
import { managedColorToCss } from '@varve/shared';
import { useCallback, useMemo, useRef } from 'react';
import { useEditor } from '../../../context';
import { InspectorColorPopover } from './InspectorColorPopover';

export interface RichTextSpanEditorProps {
  richText: RichText;
  onChange: (rich: RichText) => void;
}

const EMPTY_FORMAT: CharacterFormat = {};

const DEFAULT_COLOR: ManagedColor = { space: 'rgb', r: 0, g: 0, b: 0, a: 255 };

/** True when the given value is a legacy [r,g,b,a] tuple (pre-2.14 docs). */
function isLegacyTuple(c: unknown): c is readonly [number, number, number, number] {
  return Array.isArray(c) && c.length === 4 && c.every((n) => typeof n === 'number');
}

/** Reduce a run color (ManagedColor or legacy tuple) to ManagedColor. */
function runColorToManaged(c: unknown): ManagedColor {
  if (isLegacyTuple(c)) return { space: 'rgb', r: c[0], g: c[1], b: c[2], a: c[3] };
  if (c && typeof c === 'object' && 'space' in c) return c as ManagedColor;
  return DEFAULT_COLOR;
}

/** Reduce a run color to a CSS string for the span style. */
function runColorToCss(c: unknown): string | undefined {
  if (isLegacyTuple(c)) {
    return `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
  }
  if (c && typeof c === 'object' && 'space' in c) {
    return managedColorToCss(c as ManagedColor);
  }
  return undefined;
}

function runKey(run: TextRun, i: number): string {
  return `${i}:${run.text}`;
}

export function RichTextSpanEditor({ richText, onChange }: RichTextSpanEditorProps) {
  const editor = useEditor();
  const editorRef = useRef<HTMLDivElement>(null);

  const flatRuns = useMemo(() => {
    const out: { paraIndex: number; runIndex: number; run: TextRun }[] = [];
    richText.paragraphs.forEach((para, pi) => {
      para.runs.forEach((run, ri) => {
        out.push({ paraIndex: pi, runIndex: ri, run });
      });
    });
    return out;
  }, [richText]);

  const reportSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    // Map caret offset to a { paragraphIndex, offset } address by walking
    // the span DOM nodes. Each span carries data-para and data-run offsets.
    const range = selection.getRangeAt(0);
    const startAddr = offsetToAddress(el, range.startContainer, range.startOffset);
    const endAddr = offsetToAddress(el, range.endContainer, range.endOffset);
    if (startAddr && endAddr) {
      editor.setSelectionRange({ start: startAddr, end: endAddr });
    }
  }, [editor]);

  const applyFormat = useCallback(
    (format: CharacterFormat) => {
      const range = editor.state.selectionRange;
      if (!range) return;
      const next = applyFormatToRich(richText, range, format);
      onChange(next);
    },
    [editor.state.selectionRange, richText, onChange],
  );

  const onBlur = useCallback(() => {
    // Merge adjacent runs with identical format.
    const merged: RichText = {
      paragraphs: richText.paragraphs.map(mergeAdjacentRuns),
    };
    onChange(merged);
  }, [richText, onChange]);

  // Color of the run at the selection start (ManagedColor since 2.14;
  // legacy tuples are reduced on read). When the selection spans runs with
  // differing colors, the popover opens on the first run's color; applying
  // a new color replaces every selected run (defined policy, see M5).
  const selectionColor = useMemo(() => {
    const range = editor.state.selectionRange;
    if (!range) return undefined;
    const para = richText.paragraphs[range.start.paragraphIndex];
    if (!para) return undefined;
    let offset = 0;
    for (const run of para.runs) {
      const next = offset + run.text.length;
      if (range.start.offset < next) {
        return run.format?.color ? runColorToManaged(run.format.color) : undefined;
      }
      offset = next;
    }
    return undefined;
  }, [richText, editor.state.selectionRange]);

  const weightState = useMemo(() => {
    const range = editor.state.selectionRange;
    return range
      ? characterFormatValue(richText, range, 'fontWeight')
      : { value: undefined, mixed: false };
  }, [richText, editor.state.selectionRange]);
  const styleState = useMemo(() => {
    const range = editor.state.selectionRange;
    return range
      ? characterFormatValue(richText, range, 'fontStyle')
      : { value: undefined, mixed: false };
  }, [richText, editor.state.selectionRange]);

  return (
    <div className="rich-span-editor">
      {/*
       * An editable text surface, not a button: selection mapping below walks
       * DOM ranges inside this element, and a <button> neither exposes the
       * textbox role nor lets a caret be placed in it, so formatting could
       * never resolve a range to apply to.
       */}
      {/* biome-ignore lint/a11y/useSemanticElements: a rich-text surface holds inline formatted spans, which <textarea> cannot contain; contenteditable + role="textbox" is the correct pattern */}
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label="Rich text content"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        className="rich-span-editor__box"
        onSelect={reportSelection}
        onBlur={onBlur}
        onKeyUp={reportSelection}
      >
        {flatRuns.map(({ run, paraIndex, runIndex }, i) => {
          const fmt = run.format ?? EMPTY_FORMAT;
          return (
            <span
              key={runKey(run, i)}
              data-para={paraIndex}
              data-run={runIndex}
              data-offset={offsetOfSpan(flatRuns, i)}
              className="rich-span-editor__run"
              style={{
                fontWeight: fmt.fontWeight,
                fontStyle: fmt.fontStyle,
                fontSize: fmt.fontSize,
                fontFamily: fmt.fontFamily,
                color: runColorToCss(fmt.color),
              }}
            >
              {run.text || '​'}
            </span>
          );
        })}
      </div>
      <div className="rich-span-editor__toolbar" role="toolbar" aria-label="Text formatting">
        <button
          type="button"
          aria-label="Bold"
          aria-pressed={weightState.value === 700 && !weightState.mixed}
          data-mixed={weightState.mixed ? 'true' : undefined}
          className="rich-span-editor__btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyFormat({ fontWeight: 700 });
          }}
        >
          B
        </button>
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={styleState.value === 'italic' && !styleState.mixed}
          data-mixed={styleState.mixed ? 'true' : undefined}
          className="rich-span-editor__btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyFormat({ fontStyle: 'italic' });
          }}
        >
          I
        </button>
        <InspectorColorPopover
          label="Text color"
          value={selectionColor ?? DEFAULT_COLOR}
          onChange={(color) => {
            applyFormat({ color });
          }}
          onEditStart={editor.beginTransaction}
          onEditEnd={editor.commitTransaction}
        />
      </div>
    </div>
  );
}

// ── Selection address mapping ───────────────────────────────────────────────

function offsetToAddress(
  root: HTMLElement,
  node: Node,
  offset: number,
): { paragraphIndex: number; offset: number } | null {
  // Walk up from the text/node to the nearest span carrying data-offset.
  let cur: Node | null = node;
  let span: HTMLElement | null = null;
  while (cur && cur !== root) {
    if (cur instanceof HTMLElement && cur.hasAttribute('data-offset')) {
      span = cur;
      break;
    }
    cur = cur.parentNode;
  }
  if (span) {
    const para = Number(span.getAttribute('data-para') ?? 0);
    const baseOffset = Number(span.getAttribute('data-offset') ?? 0);
    return { paragraphIndex: para, offset: baseOffset + offset };
  }
  return null;
}

function offsetOfSpan(flatRuns: { run: TextRun }[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) {
    const r = flatRuns[i];
    if (r) offset += r.run.text.length;
  }
  return offset;
}

function applyFormatToRich(
  rich: RichText,
  range: RichSelection,
  format: CharacterFormat,
): RichText {
  return applyFormatToSelection(rich, range, format);
}
