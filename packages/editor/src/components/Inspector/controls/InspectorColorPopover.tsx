/**
 * InspectorColorPopover — portaled colour dialog for inspector swatches.
 *
 * Floats beside the trigger (prefer left so properties stay readable), with
 * Esc / outside-click / Done dismiss, focus return, and role=dialog.
 *
 * Research basis: APG Dialog (Modal); Floating UI placement; WCAG 2.2 target size.
 */
import type { BlendMode, ColorMode, Document, GradientFill, ManagedColor } from '@varve/scene';
import { managedColorKey, managedColorToRgba } from '@varve/shared';
import { FloatingPortal, FocusTrap, Icon, Select, Tooltip } from '@varve/ui';
import type { Color } from '@varve/ui/components/ColorPicker';
import { ColorPicker } from '@varve/ui/components/ColorPicker';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { addRecentColor, extractDocumentColors, getRecentColors } from '../color/colorCollections';
import { GradientEditor } from '../color/GradientEditor';
import { groupBlendOptions } from './blendModeOptionGroups';

/**
 * Current document, when rendered inside EditorProvider. Standalone renders
 * (unit tests) fall back to null.
 */
function useDocDocument(): Document | null {
  try {
    return useEditor().state.document;
  } catch {
    return null;
  }
}

/** Soft-proof session state from the editor (standalone renders: off). */
function useProofState(): {
  enabled: boolean;
  config: import('@varve/shared').ProofTransformConfig;
  toggle: (enabled: boolean) => void;
} | null {
  try {
    const editor = useEditor();
    return {
      enabled: editor.proofEnabled,
      config: {
        profileId: editor.proofConfig.profileId,
        profileName: editor.proofConfig.profileName,
        renderingIntent: editor.proofConfig.renderingIntent,
        blackPointCompensation: editor.proofConfig.blackPointCompensation,
        simulatePaperColor: editor.proofConfig.simulatePaperColor,
        simulateBlackInk: editor.proofConfig.simulateBlackInk,
      },
      toggle: editor.setProofEnabled,
    };
  } catch {
    return null;
  }
}

export interface InspectorColorPopoverProps {
  /** Accessible name for the swatch trigger (e.g. "Fill colour"). */
  label: string;
  value: ManagedColor;
  onChange: (color: ManagedColor) => void;
  /** Optional shared gradient surface rendered in the same floating panel. */
  gradient?: {
    value: GradientFill;
    onChange: (gradient: GradientFill) => void;
    documentGradientInterpolation?: import('@varve/scene').GradientInterpolationSpace;
    mixedInterpolationSpace?: boolean;
    mixedHue?: boolean;
    gradientBounds?: import('@varve/shared').Rect;
  };
  /** Swatch face styles (background / gradient). */
  swatchStyle?: React.CSSProperties;
  /**
   * Optional per-paint blend control rendered as a labelled row under the
   * picker, so a single fill does not force a trip through the row menu's
   * submenu to reach its blend mode. The host owns which modes apply and
   * receives 'mixed' for multi-selections that disagree.
   */
  blend?: {
    /** Accessible name, e.g. "Fill blend mode". */
    label: string;
    value: BlendMode | 'mixed';
    onChange: (blend: BlendMode) => void;
    options: readonly { value: BlendMode; label: string }[];
  };
  /**
   * Optional value readout rendered beside the swatch inside the trigger
   * ("#4A90E2", "Gradient", "Mixed"). When set, the trigger grows into a
   * labelled pill so the row summarises its paint without opening the picker;
   * the swatch face keeps `swatchStyle` and stays 24px.
   */
  valueText?: string;
  /** Optional class on the trigger button. */
  className?: string;
  /** Optional accessible hover/focus tooltip for the actual swatch trigger. */
  tooltipLabel?: string;
  /** Explanation when the swatch cannot be edited. */
  tooltipDisabledReason?: string;
  disabled?: boolean;
  /** Document colour mode — ColorPicker defaults initial space to match. */
  documentColorMode?: ColorMode;
  /**
   * Transaction hooks: when provided, a continuous pointer gesture inside the
   * picker (one drag on the 2D area, hue, or alpha slider) is wrapped in one
   * begin/end pair so the host's undo history records a single entry per
   * gesture instead of one entry per pointer event.
   */
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

export function InspectorColorPopover({
  label,
  value,
  onChange,
  swatchStyle,
  blend,
  valueText,
  className = 'insp-swatch',
  tooltipLabel,
  tooltipDisabledReason,
  disabled = false,
  documentColorMode,
  onEditStart,
  onEditEnd,
  gradient,
}: InspectorColorPopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = useId();
  const doc = useDocDocument();
  const proof = useProofState();
  const cmykProfile = useMemo(() => doc?.colorConfig?.cmykProfile ?? null, [doc]);
  // Document swatches are snapshotted when the picker opens — extracting
  // walks every node, so recomputing per document change during a drag would
  // add O(nodes) work to every pointer event. The snapshot updates on reopen.
  // Swatches keep the full canonical ManagedColor (native CMYK/Lab/float
  // values survive selection) — only the swatch face is 8-bit.
  const [documentColors, setDocumentColors] = useState<ManagedColor[]>([]);

  const toggle = useCallback(() => {
    if (disabled) return;
    if (!open) {
      // Capture the open-time value ONCE here — a `[open, value]` effect would
      // re-capture on every edit, making the recent-color diff always equal.
      openValueRef.current = value;
      lastEmittedRef.current = null;
      // Snapshot document swatches at open time — extracting walks every
      // node, so recomputing during a drag would add O(nodes) work to each
      // pointer event. Refreshed on the next open.
      setDocumentColors(doc ? extractDocumentColors(doc) : []);
    }
    setOpen((v) => !v);
  }, [disabled, open, doc, value]);
  const recentColors = useMemo(
    () => getRecentColors(),
    // Re-read when the picker opens so recently used colors from other
    // pickers show up.
    [open],
  );
  const [recentColorsState, setRecentColorsState] = useState<ManagedColor[]>(() => recentColors);

  useEffect(() => {
    if (open) setRecentColorsState(recentColors);
  }, [open, recentColors]);

  const gestureActiveRef = useRef(false);
  const openValueRef = useRef<ManagedColor | null>(null);
  const lastEmittedRef = useRef<ManagedColor | null>(null);

  useEffect(() => {
    if (open) {
      lastEmittedRef.current = null;
    }
  }, [open]);

  const handleChange = useCallback(
    (c: ManagedColor) => {
      lastEmittedRef.current = c;
      onChange(c);
    },
    [onChange],
  );

  const close = useCallback(() => {
    // Record a recent color when a committed edit changed the value since the
    // picker opened. Tracked from emitted changes (not the echoed prop) so the
    // record survives parents that update asynchronously. Recorded on
    // dismissal (not per preview event) so slider drags do not flood the list
    // with intermediate steps.
    const opened = openValueRef.current;
    const emitted = lastEmittedRef.current;
    if (opened && emitted && managedColorKey(opened) !== managedColorKey(emitted)) {
      setRecentColorsState(addRecentColor(emitted));
    }
    // Commit any in-flight gesture when the dialog is dismissed (Esc, Done,
    // outside click) so its changes land in exactly one undo entry.
    if (gestureActiveRef.current) {
      gestureActiveRef.current = false;
      onEditEnd?.();
    }
    setOpen(false);
    // This dialog owns the only focus handoff for its close paths. The
    // trigger may not have been focused before a synthetic or pointer open,
    // so FocusTrap's saved active element is not sufficient on its own.
    triggerRef.current?.focus({ preventScroll: true });
  }, [onEditEnd]);

  const handlePointerDownCapture = useCallback(() => {
    if (gestureActiveRef.current) return;
    gestureActiveRef.current = true;
    onEditStart?.();
  }, [onEditStart]);

  const handlePointerUpCapture = useCallback(() => {
    if (!gestureActiveRef.current) return;
    gestureActiveRef.current = false;
    onEditEnd?.();
  }, [onEditEnd]);

  // With `valueText` the swatch becomes the leading face of a labelled pill;
  // the button keeps the accessible name while the face carries swatchStyle.
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={valueText ? `${className} insp-swatch--valued` : className}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? dialogId : undefined}
      disabled={disabled}
      onClick={toggle}
      style={valueText ? undefined : swatchStyle}
    >
      {valueText ? (
        <>
          <span className="insp-swatch__face" style={swatchStyle} aria-hidden="true" />
          <span className="insp-swatch__value">{valueText}</span>
        </>
      ) : null}
    </button>
  );

  return (
    <>
      {tooltipLabel ? (
        <Tooltip label={tooltipLabel} disabledReason={tooltipDisabledReason} maxWidth={280}>
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <FloatingPortal
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        placement="left-start"
        maxHeight={560}
        id={dialogId}
        kind="dialog"
        dismissOnEscape
        className="insp-picker-popover insp-picker-popover--portaled"
      >
        <FocusTrap active={open}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-insp-color-dialog=""
            className="insp-picker-dialog"
            onPointerDownCapture={gradient ? undefined : handlePointerDownCapture}
            onPointerUpCapture={gradient ? undefined : handlePointerUpCapture}
            onPointerCancelCapture={gradient ? undefined : handlePointerUpCapture}
          >
            <div className="insp-picker-dialog__header">
              <h2 id={titleId} className="insp-picker-dialog__title">
                Pick {label}
              </h2>
              <button
                type="button"
                className="insp-picker-dialog__close"
                aria-label="Dismiss colour picker"
                onClick={close}
              >
                <Icon name="X" label={undefined} size="0.85em" />
              </button>
            </div>
            <div className="insp-picker-dialog__body">
              {gradient ? (
                <GradientEditor
                  gradient={gradient.value}
                  onChange={gradient.onChange}
                  onEditStart={onEditStart}
                  onEditEnd={onEditEnd}
                  documentColorMode={documentColorMode}
                  documentGradientInterpolation={gradient.documentGradientInterpolation}
                  mixedInterpolationSpace={gradient.mixedInterpolationSpace}
                  mixedHue={gradient.mixedHue}
                  gradientBounds={gradient.gradientBounds}
                  documentColors={documentColors}
                  recentColors={recentColorsState}
                  cmykProfile={cmykProfile}
                  previousColor={
                    openValueRef.current
                      ? (managedColorToRgba(openValueRef.current) as Color)
                      : undefined
                  }
                  proofConfig={proof?.config ?? null}
                  proofEnabled={proof?.enabled ?? false}
                  onProofToggle={proof?.toggle}
                />
              ) : (
                <ColorPicker
                  value={value}
                  onChange={handleChange}
                  documentColorMode={documentColorMode}
                  cmykProfile={cmykProfile}
                  documentColors={documentColors}
                  recentColors={recentColorsState}
                  previousColor={
                    openValueRef.current
                      ? (managedColorToRgba(openValueRef.current) as Color)
                      : undefined
                  }
                  proofConfig={proof?.config ?? null}
                  proofEnabled={proof?.enabled ?? false}
                  onProofToggle={proof?.toggle}
                />
              )}
            </div>
            {blend && (
              <div className="insp-picker-dialog__paint">
                <div className="insp-field">
                  <span className="insp-field__label">Blend mode</span>
                  <div className="insp-field__control">
                    <Select
                      label={blend.label}
                      value={blend.value === 'mixed' ? '' : blend.value}
                      options={
                        blend.value === 'mixed'
                          ? [{ value: '', label: 'Mixed', disabled: true }]
                          : []
                      }
                      groups={groupBlendOptions(blend.options)}
                      onChange={(v) => {
                        if (v) blend.onChange(v as BlendMode);
                      }}
                      placeholder="Mixed"
                    />
                  </div>
                </div>
              </div>
            )}
            <button type="button" onClick={close} className="insp-picker-done">
              Done
            </button>
          </div>
        </FocusTrap>
      </FloatingPortal>
    </>
  );
}
