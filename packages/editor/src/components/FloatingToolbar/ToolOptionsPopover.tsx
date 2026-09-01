import type { AreaSelectionSettings, AreaSelectionStyle } from '@varve/engine';
import { FloatingPortal, Icon, Switch } from '@varve/ui';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { type ToolId, useEditor } from '../../context';
import './ToolOptionsPopover.css';

const BrushLibraryPanel = lazy(() =>
  import('../BrushBrowser/BrushLibraryPanel').then((module) => ({
    default: module.BrushLibraryPanel,
  })),
);
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
const MARQUEE_TOOLS = new Set<ToolId>(['marquee', 'ellipseMarquee', 'pixelLasso']);

function AreaSelectionOptions({
  tool,
  settings,
  onChange,
}: {
  tool: ToolId;
  settings: AreaSelectionSettings;
  onChange: (patch: Partial<AreaSelectionSettings>) => void;
}) {
  const numberValue = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return (
    <div className="tool-options__selection" data-testid="marquee-options">
      <div className="tool-options__heading">
        {tool === 'ellipseMarquee' ? 'Elliptical' : 'Rectangular'} marquee
      </div>
      <fieldset className="tool-options__operation">
        <legend className="tool-options__label">Operation</legend>
        <div className="tool-options__segmented" role="radiogroup" aria-label="Operation">
          {(['replace', 'add', 'subtract', 'intersect'] as const).map(
            (operation, index, operations) => (
              // biome-ignore lint/a11y/useSemanticElements: APG radiogroup uses buttons for the custom segmented control
              <button
                key={operation}
                type="button"
                className={settings.operation === operation ? 'is-active' : ''}
                role="radio"
                aria-checked={settings.operation === operation}
                tabIndex={settings.operation === operation ? 0 : -1}
                aria-label={`${operation} selection`}
                onClick={() => onChange({ operation })}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  const delta = event.key === 'ArrowRight' ? 1 : -1;
                  const nextIndex = (index + delta + operations.length) % operations.length;
                  onChange({ operation: operations[nextIndex] });
                  const next =
                    event.currentTarget.parentElement?.querySelectorAll('button')[nextIndex];
                  next instanceof HTMLElement && next.focus();
                }}
              >
                {operation === 'replace' ? 'New' : operation[0]!.toUpperCase() + operation.slice(1)}
              </button>
            ),
          )}
        </div>
      </fieldset>
      <label className="tool-options__field">
        <span>Style</span>
        <select
          aria-label="Selection style"
          value={settings.style}
          onChange={(event) => onChange({ style: event.target.value as AreaSelectionStyle })}
        >
          <option value="normal">Normal</option>
          <option value="fixed-ratio">Fixed ratio</option>
          <option value="fixed-size">Fixed size</option>
        </select>
      </label>
      {settings.style === 'fixed-ratio' && (
        <label className="tool-options__field">
          <span>Ratio</span>
          <input
            aria-label="Selection ratio"
            type="number"
            min="0.01"
            step="0.01"
            value={settings.ratio}
            onChange={(event) => onChange({ ratio: numberValue(event.target.value) })}
          />
        </label>
      )}
      {settings.style === 'fixed-size' && (
        <div className="tool-options__field-row">
          <label className="tool-options__field">
            <span>Width</span>
            <input
              aria-label="Selection width"
              type="number"
              min="0"
              step="1"
              value={settings.fixedWidth}
              onChange={(event) => onChange({ fixedWidth: numberValue(event.target.value) })}
            />
          </label>
          <label className="tool-options__field">
            <span>Height</span>
            <input
              aria-label="Selection height"
              type="number"
              min="0"
              step="1"
              value={settings.fixedHeight}
              onChange={(event) => onChange({ fixedHeight: numberValue(event.target.value) })}
            />
          </label>
        </div>
      )}
      <label className="tool-options__field">
        <span>Feather (document px)</span>
        <input
          aria-label="Selection feather"
          type="number"
          min="0"
          step="0.5"
          value={settings.feather}
          onChange={(event) => onChange({ feather: numberValue(event.target.value) })}
        />
      </label>
      <Switch
        className="tool-options__check"
        label="Anti-alias edges"
        aria-label="Anti-alias selection edges"
        checked={settings.antialias}
        onChange={(event) => onChange({ antialias: event.target.checked })}
      />
      <Switch
        className="tool-options__check"
        label="From center"
        aria-label="Draw selection from center"
        checked={settings.fromCenter}
        onChange={(event) => onChange({ fromCenter: event.target.checked })}
      />
      <p className="tool-options__hint">
        Shift adds, Alt subtracts, and Shift+Alt intersects for this gesture.
      </p>
    </div>
  );
}

export function ToolOptionsPopover() {
  const { state, selectedNodes, setAreaSelectionSettings } = useEditor();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const supportsOptions =
    BRUSH_TOOLS.has(state.tool) ||
    MARQUEE_TOOLS.has(state.tool) ||
    state.tool === 'frame' ||
    state.tool === 'crop';

  useEffect(() => {
    setOpen(BRUSH_TOOLS.has(state.tool) || MARQUEE_TOOLS.has(state.tool));
  }, [state.tool]);

  useEffect(() => {
    if (!open) return;
    const ownerDocument = triggerRef.current?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    const focusFirstControl = () => {
      const control = popoverRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!control) return false;
      control.focus();
      return true;
    };
    const OwnerMutationObserver = ownerWindow?.MutationObserver;
    let focusObserver: MutationObserver | null = null;
    const tryFocus = () => {
      if (focusFirstControl()) {
        focusObserver?.disconnect();
        return;
      }
      // FloatingPortal mounts its measured layer after this effect runs, and
      // the brush controls may arrive later through Suspense. Observe the
      // owner document's body only until the first real control is focusable;
      // this avoids a timing guess while still cleaning the observer promptly.
      if (focusObserver && ownerDocument?.body) {
        focusObserver.observe(ownerDocument.body, { childList: true, subtree: true });
      }
    };
    if (OwnerMutationObserver) {
      focusObserver = new OwnerMutationObserver(tryFocus);
    }
    tryFocus();
    return () => {
      focusObserver?.disconnect();
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
      <FloatingPortal
        anchorRef={triggerRef}
        open={open}
        placement="top"
        maxHeight={640}
        kind="popover"
        dismissOnEscape
        onClose={(reason) => {
          setOpen(false);
          if (reason === 'escape') triggerRef.current?.focus();
        }}
        className="tool-options__popover"
      >
        <div
          ref={popoverRef}
          className="tool-options__content insp-panel"
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
              <>
                <BrushSection
                  tool={state.tool as 'paint' | 'eraser' | 'pencil' | 'smudge'}
                  sectionId="brush-settings"
                />
                {/* The pencil draws vector strokes, so raster brush presets
                    have nothing to apply to. */}
                {state.tool !== 'pencil' && <BrushLibraryPanel />}
              </>
            )}
            {MARQUEE_TOOLS.has(state.tool) && (
              <AreaSelectionOptions
                tool={state.tool}
                settings={state.areaSelectionSettings}
                onChange={setAreaSelectionSettings}
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
      </FloatingPortal>
    </div>
  );
}
