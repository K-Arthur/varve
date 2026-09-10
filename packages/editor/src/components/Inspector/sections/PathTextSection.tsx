/**
 * Text-on-path controls.
 *
 * Exposes the settings the renderer reads: `startOffset`, `endOffset`,
 * `side`, `flip`, `baselineShift` and `fitToPath`.
 *
 * Undo coalescing: a slider gesture (pointerDown → many changes →
 * pointerUp) produces one undo entry by wrapping the entire interaction
 * in a single begin/commit transaction pair.
 */
import type { SceneNode, TextNode } from '@varve/scene';
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { RangeValueControl } from '../controls/RangeValueControl';
import { SegmentedControl } from '../controls/SegmentedControl';

interface PathTextSectionProps {
  nodes: SceneNode[];
}

export function PathTextSection({ nodes }: PathTextSectionProps) {
  const { state, updateNode, beginTransaction, commitTransaction, announce } = useEditor();

  const textNodes = nodes.filter((n): n is TextNode => n.kind === 'text');
  const textNode = textNodes.length === 1 ? textNodes[0] : undefined;
  const attached = textNode?.textMode === 'path' && !!textNode.pathTextSettings;

  // ── undo coalescing ───────────────────────────────────────────────────
  // Track whether a slider gesture is in flight so the entire drag
  // produces exactly one undo entry instead of one per intermediate value.
  const inDragRef = useRef(false);

  const beginDrag = useCallback(
    (event?: ReactPointerEvent<HTMLInputElement>) => {
      if (event && !event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (!inDragRef.current) {
        inDragRef.current = true;
        beginTransaction();
      }
    },
    [beginTransaction],
  );

  const commitDrag = useCallback(
    (event?: ReactPointerEvent<HTMLInputElement>) => {
      if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (inDragRef.current) {
        inDragRef.current = false;
        commitTransaction();
      }
    },
    [commitTransaction],
  );

  useEffect(() => {
    return () => {
      if (inDragRef.current) {
        inDragRef.current = false;
        commitTransaction();
      }
    };
  }, [commitTransaction]);

  // ── patching ──────────────────────────────────────────────────────────
  const patchSettings = useCallback(
    (patch: Partial<NonNullable<TextNode['pathTextSettings']>>) => {
      if (!textNode) return;
      if (!inDragRef.current) {
        // Keyboard / programmatic change outside a gesture: immediate undo.
        beginTransaction();
        updateNode(textNode.id, (n) => {
          if (n.kind !== 'text' || !n.pathTextSettings) return n;
          return { ...n, pathTextSettings: { ...n.pathTextSettings, ...patch } };
        });
        commitTransaction();
        return;
      }
      // During a gesture the transaction is already open.
      updateNode(textNode.id, (n) => {
        if (n.kind !== 'text' || !n.pathTextSettings) return n;
        return { ...n, pathTextSettings: { ...n.pathTextSettings, ...patch } };
      });
    },
    [textNode, updateNode, beginTransaction, commitTransaction],
  );

  const detach = useCallback(() => {
    if (!textNode) return;
    beginTransaction();
    updateNode(textNode.id, (n) => {
      if (n.kind !== 'text') return n;
      const { pathTextSettings: _dropped, ...rest } = n;
      // Back to a point label: 'area' would re-wrap to a width the text has
      // not had since it was attached.
      return { ...rest, textMode: 'point' } as TextNode;
    });
    commitTransaction();
    announce?.('Text detached from path');
  }, [textNode, updateNode, beginTransaction, commitTransaction, announce]);

  if (!textNode || !attached) return null;

  const settings = textNode.pathTextSettings;
  if (!settings) return null;

  const pathNode = state.document.nodes[settings.pathNodeId];
  const percent = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value! * 100))) : fallback;
  const offsetPercent = percent(settings.startOffset, 0);
  const endPercent = percent(settings.endOffset, 100);
  const baselinePx = Number.isFinite(settings.baselineShift)
    ? Math.max(-100, Math.min(100, Math.round(settings.baselineShift! * 10) / 10))
    : 0;

  return (
    <DisclosureSection title="Text on Path" sectionId="text-on-path" defaultExpanded={true}>
      <FieldRow label="Path">
        <span className="insp-hint">{pathNode?.name ?? 'Missing path'}</span>
      </FieldRow>
      <FieldRow label="Start" htmlFor="path-text-offset-range">
        <RangeValueControl
          id="path-text-offset"
          label="Start offset"
          value={offsetPercent}
          min={0}
          max={100}
          step={1}
          unit="%"
          rangeClassName="insp-slider__input"
          rangeAriaLabel="Start offset along path"
          onRangePointerDown={beginDrag}
          onRangePointerUp={commitDrag}
          onRangePointerCancel={commitDrag}
          onChange={(value) => patchSettings({ startOffset: value / 100 })}
        />
      </FieldRow>
      <FieldRow label="End" htmlFor="path-text-end-range">
        <RangeValueControl
          id="path-text-end"
          label="End offset"
          value={endPercent}
          min={0}
          max={100}
          step={1}
          unit="%"
          rangeClassName="insp-slider__input"
          rangeAriaLabel="End offset along path"
          onRangePointerDown={beginDrag}
          onRangePointerUp={commitDrag}
          onRangePointerCancel={commitDrag}
          onChange={(value) => patchSettings({ endOffset: value / 100 })}
        />
      </FieldRow>
      <FieldRow label="Baseline" htmlFor="path-text-baseline-range">
        <RangeValueControl
          id="path-text-baseline"
          label="Baseline shift"
          value={baselinePx}
          min={-100}
          max={100}
          step={0.5}
          unit="px"
          rangeClassName="insp-slider__input"
          rangeAriaLabel="Baseline shift in pixels"
          onRangePointerDown={beginDrag}
          onRangePointerUp={commitDrag}
          onRangePointerCancel={commitDrag}
          onChange={(value) => patchSettings({ baselineShift: value })}
        />
      </FieldRow>
      <FieldRow label="Side">
        <SegmentedControl
          label="Side of path"
          value={settings.side ?? 'top'}
          options={[
            { value: 'top', label: 'Outside' },
            { value: 'bottom', label: 'Inside' },
          ]}
          onChange={(v) => patchSettings({ side: v as 'top' | 'bottom' })}
        />
      </FieldRow>
      <FieldRow label="Flip">
        <SegmentedControl
          label="Flip glyph orientation"
          value={settings.flip ? 'flipped' : 'normal'}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'flipped', label: 'Flipped' },
          ]}
          onChange={(v) => patchSettings({ flip: v === 'flipped' })}
        />
      </FieldRow>
      <FieldRow label="Fit">
        <SegmentedControl
          label="Fit text to path interval"
          value={settings.fitToPath ? 'fit' : 'clip'}
          options={[
            { value: 'clip', label: 'Clip' },
            { value: 'fit', label: 'Fit' },
          ]}
          onChange={(v) => patchSettings({ fitToPath: v === 'fit' })}
        />
      </FieldRow>
      <FieldRow label="Direction">
        <SegmentedControl
          label="Reading direction"
          value={settings.reverse ? 'reversed' : 'normal'}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'reversed', label: 'Reversed' },
          ]}
          onChange={(v) => patchSettings({ reverse: v === 'reversed' })}
        />
      </FieldRow>
      <div className="insp-actions">
        <button type="button" className="insp-btn-sm" onClick={detach}>
          Detach from path
        </button>
      </div>
    </DisclosureSection>
  );
}
