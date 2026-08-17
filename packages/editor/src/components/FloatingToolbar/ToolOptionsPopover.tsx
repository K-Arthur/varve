import { Icon } from '@varve/ui';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { type ToolId, useEditor } from '../../context';
import './ToolOptionsPopover.css';

const BrushSection = lazy(() =>
  import('../Inspector/sections/BrushSection').then((module) => ({
    default: module.BrushSection,
  })),
);
const FramePresetsSection = lazy(() =>
  import('../Inspector/sections/FramePresetsSection').then((module) => ({
    default: module.FramePresetsSection,
  })),
);
const ImageCropSection = lazy(() =>
  import('../Inspector/sections/ImageCropSection').then((module) => ({
    default: module.ImageCropSection,
  })),
);

const BRUSH_TOOLS = new Set<ToolId>(['paint', 'eraser', 'pencil', 'smudge']);

export function ToolOptionsPopover() {
  const { state, selectedNodes } = useEditor();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const supportsOptions =
    BRUSH_TOOLS.has(state.tool) || state.tool === 'frame' || state.tool === 'crop';

  useEffect(() => {
    setOpen(BRUSH_TOOLS.has(state.tool));
  }, [state.tool]);

  useEffect(() => {
    if (!open) return;
    const focusFirstControl = () => {
      const control = popoverRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!control) return false;
      control.focus();
      return true;
    };
    const focusObserver = new MutationObserver(() => {
      if (focusFirstControl()) focusObserver.disconnect();
    });
    if (!focusFirstControl() && popoverRef.current) {
      focusObserver.observe(popoverRef.current, { childList: true, subtree: true });
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const isPortaledSelect =
        target instanceof Element && target.closest('.varve-select__listbox') !== null;
      if (
        !popoverRef.current?.contains(target) &&
        !triggerRef.current?.contains(target) &&
        !isPortaledSelect
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      focusObserver.disconnect();
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!supportsOptions) return null;

  return (
    <div className="tool-options">
      <button
        ref={triggerRef}
        type="button"
        className={`floating-toolbar__btn${open ? ' floating-toolbar__btn--active' : ''}`}
        aria-label="Tool options"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="SlidersHorizontal" size={16} />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="tool-options__popover insp-panel"
          role="dialog"
          aria-label={`${state.tool} tool options`}
        >
          <Suspense
            fallback={
              <p className="insp-panel__empty-hint" role="status">
                Loading tool options…
              </p>
            }
          >
            {BRUSH_TOOLS.has(state.tool) && (
              <BrushSection
                tool={state.tool as 'paint' | 'eraser' | 'pencil' | 'smudge'}
                sectionId="brush-settings"
              />
            )}
            {state.tool === 'frame' && (
              <FramePresetsSection mode="create" sectionId="frame-presets" />
            )}
            {state.tool === 'crop' && (
              <ImageCropSection nodes={selectedNodes()} sectionId="image-crop" />
            )}
          </Suspense>
        </div>
      )}
    </div>
  );
}
