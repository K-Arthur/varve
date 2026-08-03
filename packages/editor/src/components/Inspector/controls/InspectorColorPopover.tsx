/**
 * InspectorColorPopover — portaled colour dialog for inspector swatches.
 *
 * Floats beside the trigger (prefer left so properties stay readable), with
 * Esc / outside-click / Done dismiss, focus return, and role=dialog.
 *
 * Research basis: APG Dialog (Modal); Floating UI placement; WCAG 2.2 target size.
 */
import type { ColorMode, ManagedColor } from '@strata/scene';
import { FloatingPortal, FocusTrap, Icon } from '@strata/ui';
import { ColorPicker } from '@strata/ui/components/ColorPicker';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface InspectorColorPopoverProps {
  /** Accessible name for the swatch trigger (e.g. "Fill colour"). */
  label: string;
  value: ManagedColor;
  onChange: (color: ManagedColor) => void;
  /** Swatch face styles (background / gradient). */
  swatchStyle?: React.CSSProperties;
  /** Optional class on the trigger button. */
  className?: string;
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
  className = 'insp-swatch',
  disabled = false,
  documentColorMode,
  onEditStart,
  onEditEnd,
}: InspectorColorPopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = useId();

  const gestureActiveRef = useRef(false);

  const close = useCallback(() => {
    // Commit any in-flight gesture when the dialog is dismissed (Esc, Done,
    // outside click) so its changes land in exactly one undo entry.
    if (gestureActiveRef.current) {
      gestureActiveRef.current = false;
      onEditEnd?.();
    }
    setOpen(false);
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

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((v) => !v);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        disabled={disabled}
        onClick={toggle}
        style={swatchStyle}
      />
      <FloatingPortal
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        placement="left-start"
        maxHeight={560}
        id={dialogId}
        className="insp-picker-popover insp-picker-popover--portaled"
      >
        <FocusTrap active={open}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-insp-color-dialog=""
            className="insp-picker-dialog"
            onPointerDownCapture={handlePointerDownCapture}
            onPointerUpCapture={handlePointerUpCapture}
            onPointerCancelCapture={handlePointerUpCapture}
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
            <ColorPicker value={value} onChange={onChange} documentColorMode={documentColorMode} />
            <button type="button" onClick={close} className="insp-picker-done">
              Done
            </button>
          </div>
        </FocusTrap>
      </FloatingPortal>
    </>
  );
}
