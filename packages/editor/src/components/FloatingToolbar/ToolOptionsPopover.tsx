import type { AreaSelectionSettings, AreaSelectionStyle } from '@varve/engine';
import {
  FloatingPortal,
  getFocusableElements,
  NativeSelect,
  Switch,
  ToggleButton,
} from '@varve/ui';
import {
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  Suspense,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type ToolId, useEditor } from '../../context';
import { setToolOptionsHandler } from '../../context/toolOptionsBridge';
import { toolLabel } from '../../tools/toolRegistry';
import { NumberField } from '../Inspector/controls/NumberField';
import { hasToolOptions } from '../Inspector/toolContext';
import { type RetouchToolId, RetouchToolOptions } from './RetouchToolOptions';
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
const ImageCropSection = lazy(() =>
  import('../Inspector/sections/ImageCropSection').then((module) => ({
    default: module.ImageCropSection,
  })),
);
const LiquifyOptionsPanel = lazy(() =>
  import('./LiquifyToolOptions').then((module) => ({
    default: module.LiquifyOptionsPanel,
  })),
);

const BRUSH_TOOLS = new Set<ToolId>(['paint', 'eraser', 'pencil', 'smudge']);
const MARQUEE_TOOLS = new Set<ToolId>(['marquee', 'ellipseMarquee', 'pixelLasso']);
const MAGIC_WAND_TOOLS = new Set<ToolId>(['magicWand']);
const RETOUCH_TOOLS = new Set<ToolId>(['cloneStamp', 'healBrush', 'spotHeal', 'patch']);
const DEFAULT_TEXT_CREATION_SETTINGS = {
  writingMode: 'horizontal-tb' as const,
  textOrientation: 'mixed' as const,
};

/**
 * One segmented-control grammar for every mutually exclusive tool-option row.
 * Roving tabindex with arrow keys (APG radiogroup): the marquee's Operation
 * control already worked this way, the magic wand's did not, so the two
 * visually identical groups behaved differently by keyboard.
 */
function SegmentedRadioGroup<T extends string>({
  ariaLabel,
  legend,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  legend?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const move = (event: ReactKeyboardEvent<HTMLElement>, delta: number) => {
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + delta + options.length) % options.length]!;
    onChange(next.value);
    // Query the group, not the pressed button: currentTarget has no
    // descendants, so the old node-scoped lookup silently no-oped.
    const group = event.currentTarget.closest('[role="radiogroup"]');
    const nextButton = group?.querySelectorAll('button')[options.indexOf(next)];
    nextButton instanceof HTMLElement && nextButton.focus();
  };
  return (
    <fieldset className="tool-options__operation">
      {legend && <legend className="tool-options__label">{legend}</legend>}
      <div className="tool-options__segmented" role="radiogroup" aria-label={ariaLabel}>
        {options.map((option) => (
          // biome-ignore lint/a11y/useSemanticElements: APG radiogroup uses buttons for the custom segmented control
          <button
            key={option.value}
            type="button"
            className={value === option.value ? 'is-active' : ''}
            role="radio"
            aria-checked={value === option.value}
            tabIndex={value === option.value ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                move(event, -1);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                move(event, 1);
              }
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function AreaSelectionOptions({
  tool,
  settings,
  onChange,
}: {
  tool: ToolId;
  settings: AreaSelectionSettings;
  onChange: (patch: Partial<AreaSelectionSettings>) => void;
}) {
  return (
    <div className="tool-options__selection" data-testid="marquee-options">
      <div className="tool-options__heading">
        {tool === 'ellipseMarquee' ? 'Elliptical' : 'Rectangular'} marquee
      </div>
      <SegmentedRadioGroup
        legend="Operation"
        ariaLabel="Operation"
        value={settings.operation}
        options={[
          { value: 'replace', label: 'New' },
          { value: 'add', label: 'Add' },
          { value: 'subtract', label: 'Subtract' },
          { value: 'intersect', label: 'Intersect' },
        ]}
        onChange={(operation) => onChange({ operation })}
      />
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
        <NumberField
          label="Ratio (width over height)"
          displayLabel="Ratio"
          value={settings.ratio}
          min={0.01}
          step={0.01}
          onChange={(ratio) => onChange({ ratio })}
        />
      )}
      {settings.style === 'fixed-size' && (
        <div className="tool-options__field-row">
          <NumberField
            label="Selection width"
            displayLabel="Width"
            unit="px"
            value={settings.fixedWidth}
            min={0}
            step={1}
            onChange={(fixedWidth) => onChange({ fixedWidth })}
          />
          <NumberField
            label="Selection height"
            displayLabel="Height"
            unit="px"
            value={settings.fixedHeight}
            min={0}
            step={1}
            onChange={(fixedHeight) => onChange({ fixedHeight })}
          />
        </div>
      )}
      <NumberField
        label="Selection feather"
        displayLabel="Feather"
        unit="px"
        value={settings.feather}
        min={0}
        step={0.5}
        onChange={(feather) => onChange({ feather })}
      />
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
      <SegmentedRadioGroup
        legend="Operation"
        ariaLabel="Operation"
        value={settings.operation}
        options={[
          { value: 'replace', label: 'Replace' },
          { value: 'add', label: 'Add' },
          { value: 'subtract', label: 'Subtract' },
          { value: 'intersect', label: 'Intersect' },
        ]}
        onChange={(operation) => onChange({ operation })}
      />
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
      <SegmentedRadioGroup
        legend="Mode"
        ariaLabel="Selection mode"
        value={settings.mode}
        options={[
          { value: 'contiguous', label: 'Contiguous' },
          { value: 'global', label: 'Global' },
        ]}
        onChange={(mode) => onChange({ mode })}
      />
      <p className="tool-options__hint">
        Click on an image to select similar colours. Shift adds, Alt subtracts.
      </p>
    </div>
  );
}

function TextToolOptions({
  settings,
  onChange,
}: {
  settings: {
    writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
    textOrientation: 'mixed' | 'upright' | 'sideways';
  };
  onChange: (patch: Partial<typeof settings>) => void;
}) {
  return (
    <div className="tool-options__selection" data-testid="text-options">
      <div className="tool-options__heading">New text</div>
      <NativeSelect
        className="tool-options__field tool-options__native-select"
        label="Writing mode"
        value={settings.writingMode}
        onValueChange={(value) => onChange({ writingMode: value as typeof settings.writingMode })}
        options={[
          { value: 'horizontal-tb', label: 'Horizontal' },
          { value: 'vertical-rl', label: 'Vertical right-to-left' },
          { value: 'vertical-lr', label: 'Vertical left-to-right' },
        ]}
      />
      <NativeSelect
        className="tool-options__field tool-options__native-select"
        label="Character orientation"
        value={settings.textOrientation}
        onValueChange={(value) =>
          onChange({ textOrientation: value as typeof settings.textOrientation })
        }
        options={[
          { value: 'mixed', label: 'Mixed (vertical)' },
          { value: 'upright', label: 'Upright' },
          { value: 'sideways', label: 'Sideways' },
        ]}
      />
      <p className="tool-options__hint">
        These defaults apply to the next text layer. Object rotation and vertical alignment stay
        separate.
      </p>
    </div>
  );
}

export function ToolOptionsPopover() {
  const { state, selectedNodes, setAreaSelectionSettings, setMagicWandSettings, patch } =
    useEditor();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Why the surface is open decides focus policy: a tool change or a pointer
  // click must not pull focus off the canvas; an explicit keyboard/command
  // activation is a navigation intent and moves focus into the panel.
  const openSourceRef = useRef<'tool-change' | 'pointer' | 'keyboard' | 'command'>('tool-change');
  const keyboardTriggerRef = useRef(false);
  // One map decides which tools have options here; the Inspector reads the
  // same map, so it only offers "Show … options" when this popover has content.
  const supportsOptions = hasToolOptions(state.tool);

  useEffect(() => {
    if (!supportsOptions) return;
    setToolOptionsHandler(() => {
      openSourceRef.current = 'command';
      setOpen(true);
    });
    return () => setToolOptionsHandler(null);
  }, [supportsOptions]);

  useEffect(() => {
    openSourceRef.current = 'tool-change';
    setOpen(
      BRUSH_TOOLS.has(state.tool) ||
        MARQUEE_TOOLS.has(state.tool) ||
        MAGIC_WAND_TOOLS.has(state.tool) ||
        RETOUCH_TOOLS.has(state.tool) ||
        state.tool === 'liquify' ||
        state.tool === 'text',
    );
  }, [state.tool]);

  useEffect(() => {
    if (!open) return;
    const source = openSourceRef.current;
    if (source === 'tool-change' || source === 'pointer') return;
    const ownerDocument = triggerRef.current?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    // The focus attempt only counts as successful when the control actually
    // received focus. Before FloatingPortal's placement makes the layer
    // visible, `focus()` is a silent no-op — the old check returned true for
    // "found a control" and stranded focus on the trigger.
    const focusFirstControl = () => {
      const container = popoverRef.current;
      if (!container) return false;
      const control = getFocusableElements(container)[0];
      if (!control) return false;
      control.focus();
      return control === control.ownerDocument.activeElement;
    };
    const OwnerMutationObserver = ownerWindow?.MutationObserver;
    let focusObserver: MutationObserver | null = null;
    const tryFocus = () => {
      if (focusFirstControl()) {
        focusObserver?.disconnect();
        return;
      }
      // Watch the owner body until the layer becomes visible or its lazy
      // controls arrive; style/attribute changes matter because placement
      // flips visibility without replacing nodes.
      if (focusObserver && ownerDocument?.body) {
        focusObserver.observe(ownerDocument.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class', 'hidden'],
        });
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
        onPressedChange={(pressed) => {
          openSourceRef.current = keyboardTriggerRef.current ? 'keyboard' : 'pointer';
          keyboardTriggerRef.current = false;
          setOpen(pressed);
        }}
        onKeyDownCapture={() => {
          keyboardTriggerRef.current = true;
        }}
        onBlur={() => {
          keyboardTriggerRef.current = false;
        }}
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
        yieldTabToAnchor
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
          aria-label={`${toolLabel(state.tool)} tool options`}
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
            {MAGIC_WAND_TOOLS.has(state.tool) && (
              <MagicWandOptions
                settings={state.magicWandSettings}
                onChange={setMagicWandSettings}
              />
            )}
            {RETOUCH_TOOLS.has(state.tool) && (
              <RetouchToolOptions tool={state.tool as RetouchToolId} />
            )}
            {state.tool === 'text' && (
              <TextToolOptions
                settings={state.textCreationSettings ?? DEFAULT_TEXT_CREATION_SETTINGS}
                onChange={(settings) =>
                  patch({
                    textCreationSettings: {
                      ...DEFAULT_TEXT_CREATION_SETTINGS,
                      ...state.textCreationSettings,
                      ...settings,
                    },
                  })
                }
              />
            )}
            {state.tool === 'liquify' && <LiquifyOptionsPanel />}
            {state.tool === 'crop' && (
              <ImageCropSection nodes={selectedNodes()} sectionId="image-crop" />
            )}
          </Suspense>
        </div>
      </FloatingPortal>
    </div>
  );
}
