import type { AreaSelectionSettings, AreaSelectionStyle } from '@varve/engine';
import { FloatingPortal, NativeSelect, Switch, ToggleButton } from '@varve/ui';
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
const MAGIC_WAND_TOOLS = new Set<ToolId>(['magicWand']);

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
      <NativeSelect
        className="tool-options__field tool-options__native-select"
        label="Selection style"
        value={settings.style}
        onValueChange={(value) => onChange({ style: value as AreaSelectionStyle })}
        options={[
          { value: 'normal', label: 'Normal' },
          { value: 'fixed-ratio', label: 'Fixed ratio' },
          { value: 'fixed-size', label: 'Fixed size' },
        ]}
      />
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

function MagicWandOptions({
  settings,
  onChange,
}: {
  settings: import('../../tools/magicWandSettings').MagicWandSettings;
  onChange: (patch: Partial<import('../../tools/magicWandSettings').MagicWandSettings>) => void;
}) {
  return (
    <div className="tool-options__selection" data-testid="magicwand-options">
      <div className="tool-options__heading">Magic Wand</div>
      <fieldset className="tool-options__operation">
        <legend className="tool-options__label">Operation</legend>
        <div className="tool-options__segmented">
          {(['replace', 'add', 'subtract', 'intersect'] as const).map((op) => (
            <button
              key={op}
              type="button"
              className={settings.operation === op ? 'is-active' : ''}
              aria-pressed={settings.operation === op}
              aria-label={`${op} selection`}
              onClick={() => onChange({ operation: op })}
            >
              {op.charAt(0).toUpperCase() + op.slice(1)}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="tool-options__field">
        <span className="tool-options__label">Tolerance</span>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.tolerance}
          onChange={(e) => onChange({ tolerance: Number(e.target.value) })}
          aria-label="Colour tolerance"
        />
        <span className="tool-options__value">{settings.tolerance}</span>
      </label>
      <label className="tool-options__field">
        <span className="tool-options__label">Feather</span>
        <input
          type="range"
          min={0}
          max={50}
          value={settings.edgeFeather}
          onChange={(e) => onChange({ edgeFeather: Number(e.target.value) })}
          aria-label="Colour range feather"
        />
        <span className="tool-options__value">{settings.edgeFeather}</span>
      </label>
      <fieldset className="tool-options__operation">
        <legend className="tool-options__label">Mode</legend>
        <div className="tool-options__segmented">
          <button
            type="button"
            className={settings.mode === 'contiguous' ? 'is-active' : ''}
            aria-pressed={settings.mode === 'contiguous'}
            onClick={() => onChange({ mode: 'contiguous' })}
          >
            Contiguous
          </button>
          <button
            type="button"
            className={settings.mode === 'global' ? 'is-active' : ''}
            aria-pressed={settings.mode === 'global'}
            onClick={() => onChange({ mode: 'global' })}
          >
            Global
          </button>
        </div>
      </fieldset>
      <p className="tool-options__hint">
        Click on an image to select similar colours. Shift adds, Alt subtracts.
      </p>
    </div>
  );
}

export function ToolOptionsPopover() {
  const { state, selectedNodes, setAreaSelectionSettings, setMagicWandSettings } = useEditor();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const supportsOptions =
    BRUSH_TOOLS.has(state.tool) ||
    MARQUEE_TOOLS.has(state.tool) ||
    MAGIC_WAND_TOOLS.has(state.tool) ||
    state.tool === 'frame' ||
    state.tool === 'crop';

  useEffect(() => {
    setOpen(
      BRUSH_TOOLS.has(state.tool) ||
        MARQUEE_TOOLS.has(state.tool) ||
        MAGIC_WAND_TOOLS.has(state.tool),
    );
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
      <ToggleButton
        ref={triggerRef}
        size="sm"
        icon="SlidersHorizontal"
        label="Tool options"
        pressed={open}
        onPressedChange={setOpen}
        className={`floating-toolbar__btn${open ? ' floating-toolbar__btn--active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      />
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
            {MAGIC_WAND_TOOLS.has(state.tool) && (
              <MagicWandOptions
                settings={state.magicWandSettings}
                onChange={setMagicWandSettings}
              />
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
