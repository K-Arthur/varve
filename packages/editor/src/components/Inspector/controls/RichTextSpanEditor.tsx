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

import type { CharacterFormat, RichSelection, RichText, TextRun } from '@strata/scene';
import { applyFormatToSelection, mergeAdjacentRuns } from '@strata/scene';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { InspectorColorPopover } from './InspectorColorPopover';

export interface RichTextSpanEditorProps {
  richText: RichText;
  onChange: (rich: RichText) => void;
}

const EMPTY_FORMAT: CharacterFormat = {};

function runKey(run: TextRun, i: number): string {
  return `${i}:${run.text}`;
}

export function RichTextSpanEditor({ richText, onChange }: RichTextSpanEditorProps) {
  const editor = useEditor();
  const editorRef = useRef<HTMLDivElement>(null);
  const [colorTarget, setColorTarget] = useState<{
    runIndex: number;
    anchor: HTMLElement;
  } | null>(null);

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

  return (
    <div className="rich-span-editor">
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label="Rich text content"
        tabIndex={0}
        className="rich-span-editor__box"
        onSelect={reportSelection}
        onBlur={onBlur}
        onKeyUp={reportSelection}
      >
        {flatRuns.map(({ run, paraIndex, runIndex }, i) => {
          const fmt = run.format ?? EMPTY_FORMAT;
          const isBold = fmt.fontWeight && fmt.fontWeight >= 600;
          const isItalic = fmt.fontStyle === 'italic';
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
                color: fmt.color
                  ? `rgba(${fmt.color[0]},${fmt.color[1]},${fmt.color[2]},${fmt.color[3] / 255})`
                  : undefined,
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
          aria-pressed={false}
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
          aria-pressed={false}
          className="rich-span-editor__btn"
          onMouseDown={(e) => {
            e.preventDefault();
            applyFormat({ fontStyle: 'italic' });
          }}
        >
          I
        </button>
        <button
          type="button"
          aria-label="Text color"
          className="rich-span-editor__btn"
          ref={(el) => {
            if (el && colorTarget) {
              // anchor already set via click below
            }
          }}
          onClick={(e) => {
            setColorTarget({ runIndex: 0, anchor: e.currentTarget });
          }}
        >
          Color
        </button>
      </div>
      {colorTarget && (
        <InspectorColorPopover
          anchorEl={colorTarget.anchor}
          onClose={() => setColorTarget(null)}
          onColorSelected={(rgba) => {
            applyFormat({ color: rgba });
            setColorTarget(null);
          }}
        />
      )}
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
    offset += flatRuns[i].run.text.length;
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
