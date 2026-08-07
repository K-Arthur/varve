import type { TemplateLibrary } from '@varve/platform';
import type { NewDocumentRequest } from '@varve/scene';
import {
  BUILTIN_PRESET_GROUPS,
  type ColorMode,
  type CustomPreset,
  type DocumentUnit,
  type Preset,
  type PresetBleed,
  simplifyRatio,
} from '@varve/shared';
import {
  Button,
  Checkbox,
  Dialog,
  IconButton,
  NumberInput,
  PresetPicker,
  SegmentedControl,
  type SegmentedOption,
} from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TemplatesGallery } from './TemplatesGallery';

export interface NewDesignDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (request: NewDocumentRequest) => void;
  /** Suggested document name (e.g. "Untitled 3"). Editable; never
   *  filename-sanitized here — that happens at save time. */
  defaultName?: string;
  templates?: TemplateLibrary[];
  customPresets?: CustomPreset[];
  favoriteIds?: Set<string>;
  recentIds?: string[];
  onToggleFavoritePreset?: (preset: Preset) => void;
  onRecordRecentPreset?: (preset: Preset) => void;
  onSaveCustomPreset?: (
    input: Omit<CustomPreset, 'id' | 'category' | 'createdAt' | 'updatedAt'>,
  ) => { error: string | null };
  onEditCustomPreset?: (preset: CustomPreset) => void;
  onDuplicateCustomPreset?: (preset: CustomPreset) => void;
  onDeleteCustomPreset?: (preset: CustomPreset) => void;
}

type StartMode = 'empty' | 'frame' | 'template';
type FrameSource = 'preset' | 'custom';
type DocumentIntent = 'screen' | 'print';

const unitOptions: SegmentedOption<DocumentUnit>[] = [
  { value: 'px', label: 'px' },
  { value: 'pt', label: 'pt' },
  { value: 'in', label: 'in' },
  { value: 'cm', label: 'cm' },
  { value: 'mm', label: 'mm' },
];

const intentOptions: SegmentedOption<DocumentIntent>[] = [
  { value: 'screen', label: 'Screen' },
  { value: 'print', label: 'Print' },
];

const colorModeOptions: SegmentedOption<ColorMode>[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'cmyk', label: 'CMYK' },
  { value: 'grayscale', label: 'Grayscale' },
];

/** Default custom-frame settings shown on first open of the dialog. */
const defaultCustomFrame: { width: number; height: number; unit: DocumentUnit } = {
  width: 1920,
  height: 1080,
  unit: 'px',
};

const DEFAULT_PRESET_ID = 'ig-post';

function defaultPreset(): Preset {
  return (
    BUILTIN_PRESET_GROUPS.flatMap((g) => g.presets).find((p) => p.id === DEFAULT_PRESET_ID) ??
    BUILTIN_PRESET_GROUPS[0]!.presets[0]!
  );
}

function isPrintPreset(preset: Preset): boolean {
  return preset.colorMode === 'cmyk' || preset.dpi != null || preset.bleed != null;
}

export function NewDesignDialog({
  open,
  onClose,
  onCreate,
  defaultName,
  templates,
  customPresets,
  favoriteIds,
  recentIds,
  onToggleFavoritePreset,
  onRecordRecentPreset,
  onSaveCustomPreset,
  onEditCustomPreset,
  onDuplicateCustomPreset,
  onDeleteCustomPreset,
}: NewDesignDialogProps) {
  const [name, setName] = useState('');
  const [startMode, setStartMode] = useState<StartMode>('empty');
  const [frameSource, setFrameSource] = useState<FrameSource>('preset');
  const [selectedPreset, setSelectedPreset] = useState<Preset>(() => defaultPreset());
  const [customW, setCustomW] = useState(defaultCustomFrame.width);
  const [customH, setCustomH] = useState(defaultCustomFrame.height);
  const [unit, setUnit] = useState<DocumentUnit>(defaultCustomFrame.unit);
  const [ratioLocked, setRatioLocked] = useState(false);
  const [lockedRatio, setLockedRatio] = useState(() =>
    simplifyRatio(defaultCustomFrame.width, defaultCustomFrame.height),
  );
  const [intent, setIntent] = useState<DocumentIntent>('screen');
  const [colorMode, setColorMode] = useState<ColorMode>('rgb');
  const [bleed, setBleed] = useState(3);
  const [dpi, setDpi] = useState(300);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingPresetName, setSavingPresetName] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Reset per-open state, remembering the previously focused element so we
  // can restore focus when the dialog closes (native <dialog> does not).
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      setName(defaultName ?? '');
      setStartMode('empty');
      setFrameSource('preset');
      setAdvancedOpen(false);
      setCreating(false);
      setSavingPresetName(null);
      setIntent('screen');
      setColorMode('rgb');
      setBleed(3);
      setDpi(300);
      // Let the native dialog finish mounting before focusing the name field.
      requestAnimationFrame(() => nameInputRef.current?.select());
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current.focus?.();
      restoreFocusRef.current = null;
    }
  }, [open, defaultName]);

  const handleCreate = useCallback(() => {
    if (creating) return;
    const trimmed = name.trim();

    let request: NewDocumentRequest;
    if (startMode === 'template') {
      // Template flow calls onCreate directly from the gallery.
      return;
    }
    if (startMode === 'frame' && frameSource === 'custom') {
      request = {
        documentName: trimmed || defaultName,
        startMode: 'customFrame',
        customFrame: { width: customW, height: customH, unit },
      };
    } else if (startMode === 'frame') {
      request = {
        documentName: trimmed || defaultName,
        startMode: 'framePreset',
        preset: selectedPreset,
      };
    } else {
      // Print intent (or a non-RGB color mode) creates a PAGED document —
      // print/publication work needs pages, spreads and print geometry
      // (M14). Screen intent stays on the flat infinite canvas.
      request = {
        documentName: trimmed || defaultName,
        startMode: intent === 'print' || colorMode !== 'rgb' ? 'pages' : 'empty',
      };
    }

    if (intent === 'print' || colorMode !== 'rgb') {
      request.colorMode = colorMode;
      if (intent === 'print') {
        request.bleed = { value: bleed || 3, unit } as PresetBleed;
        request.dpi = dpi;
      }
    }
    setCreating(true);
    onCreate(request);
  }, [
    creating,
    name,
    defaultName,
    startMode,
    frameSource,
    customW,
    customH,
    unit,
    selectedPreset,
    intent,
    colorMode,
    bleed,
    dpi,
    onCreate,
  ]);

  const handleTemplateSelect = useCallback(
    (template: TemplateLibrary) => {
      if (creating) return;
      setCreating(true);
      onCreate({
        documentName: name.trim() || defaultName,
        startMode: 'template',
        templateJson: template.documentJson,
      });
    },
    [creating, name, defaultName, onCreate],
  );

  const handleSelectPreset = useCallback(
    (preset: Preset) => {
      setSelectedPreset(preset);
      setFrameSource('preset');
      setUnit(preset.unit);
      setIntent(isPrintPreset(preset) ? 'print' : 'screen');
      setColorMode(preset.colorMode ?? 'rgb');
      setBleed(preset.bleed?.value ?? 3);
      setDpi(preset.dpi ?? 300);
      // Print presets reveal their print settings automatically.
      if (isPrintPreset(preset)) setAdvancedOpen(true);
      onRecordRecentPreset?.(preset);
    },
    [onRecordRecentPreset],
  );

  const handleSwitchToCustom = useCallback(() => {
    setFrameSource('custom');
    // Seed the custom fields from the selected preset's canonical dimensions.
    setCustomW(selectedPreset.width);
    setCustomH(selectedPreset.height);
    setUnit(selectedPreset.unit);
    setLockedRatio(
      selectedPreset.aspectRatio ?? simplifyRatio(selectedPreset.width, selectedPreset.height),
    );
  }, [selectedPreset]);

  const handleSwitchToPresets = useCallback(() => {
    setFrameSource('preset');
  }, []);

  const handleWidthChange = useCallback(
    (value: number) => {
      setCustomW(value);
      if (ratioLocked) setCustomH(Math.round((value / lockedRatio.w) * lockedRatio.h));
    },
    [ratioLocked, lockedRatio],
  );

  const handleHeightChange = useCallback(
    (value: number) => {
      setCustomH(value);
      if (ratioLocked) setCustomW(Math.round((value / lockedRatio.h) * lockedRatio.w));
    },
    [ratioLocked, lockedRatio],
  );

  const handleToggleRatioLock = useCallback(() => {
    setRatioLocked((prev) => {
      if (!prev) setLockedRatio(simplifyRatio(customW, customH));
      return !prev;
    });
  }, [customW, customH]);

  const handleSwapOrientation = useCallback(() => {
    setCustomW((w) => {
      const next = customH;
      setCustomH(w);
      setLockedRatio((r) => ({ w: r.h, h: r.w }));
      return next;
    });
  }, [customH]);

  const handleSaveCustomPresetClick = useCallback(() => {
    setSavingPresetName(selectedPreset.name);
  }, [selectedPreset.name]);

  const handleConfirmSaveCustomPreset = useCallback(() => {
    if (!savingPresetName || !onSaveCustomPreset) return;
    const result = onSaveCustomPreset({
      name: savingPresetName,
      width: customW,
      height: customH,
      unit,
      orientation: customW === customH ? 'square' : customW > customH ? 'landscape' : 'portrait',
      colorMode,
      bleed: intent === 'print' ? { value: bleed || 3, unit } : undefined,
      dpi: intent === 'print' ? dpi : undefined,
    });
    if (!result.error) setSavingPresetName(null);
  }, [savingPresetName, onSaveCustomPreset, customW, customH, unit, colorMode, intent, bleed, dpi]);

  // Enter creates the design — unless focus is in a control that owns Enter
  // (text inputs, the preset listbox's roving navigation, buttons).
  const handleDialogKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, button, [role="listbox"], [role="option"]')) {
        return;
      }
      e.preventDefault();
      handleCreate();
    },
    [handleCreate],
  );

  const customValid =
    Number.isFinite(customW) && Number.isFinite(customH) && customW > 0 && customH > 0;
  const showSaveAsPreset =
    onSaveCustomPreset != null && startMode === 'frame' && frameSource === 'custom' && customValid;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New design"
      size="lg"
      onKeyDown={handleDialogKeyDown}
      footer={
        <>
          <div className="new-design__footer-left">
            {showSaveAsPreset && savingPresetName === null && (
              <Button variant="ghost" size="sm" onClick={handleSaveCustomPresetClick}>
                Save as preset
              </Button>
            )}
            {showSaveAsPreset && savingPresetName !== null && (
              <div className="new-design__save-preset-row">
                <input
                  type="text"
                  className="new-design__save-preset-input"
                  value={savingPresetName}
                  onChange={(e) => setSavingPresetName(e.target.value)}
                  aria-label="Preset name"
                />
                <Button variant="primary" size="sm" onClick={handleConfirmSaveCustomPreset}>
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSavingPresetName(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
          <div className="new-design__footer-right">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={
                creating || (startMode === 'frame' && frameSource === 'custom' && !customValid)
              }
              data-testid="create-design-button"
            >
              Create design
            </Button>
          </div>
        </>
      }
    >
      <div className="new-design">
        <div className="new-design__name-row">
          <label htmlFor="new-design-name" className="new-design__name-label">
            Name
          </label>
          <input
            ref={nameInputRef}
            id="new-design-name"
            type="text"
            className="new-design__name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName ?? 'Untitled 1'}
            aria-label="Document name"
            maxLength={240}
          />
        </div>

        <fieldset className="new-design__start">
          <legend className="new-design__start-legend">Starting point</legend>
          <div className="new-design__start-options" role="radiogroup" aria-label="Starting point">
            {(
              [
                [
                  'empty',
                  'Empty document',
                  'Start on an unbounded canvas with no frame. Add frames or pages anytime.',
                ],
                [
                  'frame',
                  'Start with a frame',
                  'Create the first frame from a preset or custom size.',
                ],
                ['template', 'Template', 'Start from a template with ready-made content.'],
              ] as const
            ).map(([mode, label, hint]) => (
              <label
                key={mode}
                className={`new-design__start-card${startMode === mode ? ' new-design__start-card--active' : ''}`}
              >
                <input
                  type="radio"
                  name="new-design-start"
                  value={mode}
                  checked={startMode === mode}
                  onChange={() => setStartMode(mode)}
                  className="new-design__start-card-input"
                />
                <span className="new-design__start-card-title">{label}</span>
                <span className="new-design__start-card-hint">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {startMode === 'empty' && (
          <div className="new-design__body-section">
            <p className="new-design__empty-hint" role="note">
              An empty Varve document is an infinite canvas — there are no page bounds. Create
              frames with the Frame tool (F) whenever you need a sized area, and add pages for print
              layouts.
            </p>
          </div>
        )}

        {startMode === 'frame' && (
          <div className="new-design__body-section">
            <SegmentedControl
              label="Frame size source"
              value={frameSource}
              options={[
                { value: 'preset', label: 'Presets' },
                { value: 'custom', label: 'Custom size' },
              ]}
              onChange={(v: string) =>
                v === 'custom' ? handleSwitchToCustom() : handleSwitchToPresets()
              }
            />
            {frameSource === 'preset' ? (
              <PresetPicker
                groups={BUILTIN_PRESET_GROUPS}
                customPresets={customPresets}
                recentIds={recentIds}
                favoriteIds={favoriteIds}
                selectedId={selectedPreset.id}
                label="Frame presets"
                onSelect={handleSelectPreset}
                onToggleFavorite={onToggleFavoritePreset}
                onEditCustom={onEditCustomPreset}
                onDuplicateCustom={onDuplicateCustomPreset}
                onDeleteCustom={onDeleteCustomPreset}
              />
            ) : (
              <div className="new-design__custom">
                <div className="new-design__field-row">
                  <label htmlFor="custom-width" className="new-design__field-label">
                    Width
                  </label>
                  <NumberInput
                    value={customW}
                    onChange={handleWidthChange}
                    min={1}
                    max={100000}
                    label="Width"
                    id="custom-width"
                  />
                  <label htmlFor="custom-height" className="new-design__field-label">
                    Height
                  </label>
                  <NumberInput
                    value={customH}
                    onChange={handleHeightChange}
                    min={1}
                    max={100000}
                    label="Height"
                    id="custom-height"
                  />
                  <span className="new-design__field-label new-design__field-label--unit">
                    Unit
                  </span>
                  <SegmentedControl
                    label="Unit"
                    value={unit}
                    options={unitOptions}
                    onChange={(u: string) => setUnit(u as DocumentUnit)}
                  />
                </div>
                <div className="new-design__field-row">
                  <Checkbox
                    label="Lock aspect ratio"
                    checked={ratioLocked}
                    onChange={() => handleToggleRatioLock()}
                  />
                  <IconButton
                    icon="ArrowLeftRight"
                    label="Swap width and height"
                    size="sm"
                    variant="ghost"
                    onClick={handleSwapOrientation}
                  />
                </div>
                <p className="new-design__custom-hint">
                  These dimensions create the first frame on an unbounded canvas — the document
                  itself has no size.
                </p>
              </div>
            )}
          </div>
        )}

        {startMode === 'template' && (
          <div className="new-design__body-section">
            <TemplatesGallery templates={templates} showSearch onSelect={handleTemplateSelect} />
          </div>
        )}

        <div className="new-design__advanced">
          <button
            type="button"
            className="new-design__advanced-toggle"
            aria-expanded={advancedOpen}
            aria-controls="new-design-advanced"
            onClick={() => setAdvancedOpen((o) => !o)}
          >
            <span className="new-design__advanced-toggle-label">Advanced settings</span>
            <span className="new-design__advanced-toggle-hint">
              {intent === 'print'
                ? 'Print intent: CMYK, bleed, DPI'
                : 'Screen intent: RGB at 8-bit'}
            </span>
            <span
              className={`new-design__advanced-chevron${advancedOpen ? ' new-design__advanced-chevron--open' : ''}`}
              aria-hidden
            >
              ▾
            </span>
          </button>
          {advancedOpen && (
            <div id="new-design-advanced" className="new-design__advanced-panel">
              <div className="new-design__field-row">
                <span className="new-design__field-label">Intent</span>
                <SegmentedControl
                  label="Document intent"
                  value={intent}
                  options={intentOptions}
                  onChange={(v: string) => {
                    setIntent(v as DocumentIntent);
                    if (v === 'print') {
                      setColorMode((m) => (m === 'rgb' ? 'cmyk' : m));
                    }
                  }}
                />
                <span className="new-design__field-label new-design__field-label--gap">Color</span>
                <SegmentedControl
                  label="Color mode"
                  value={colorMode}
                  options={colorModeOptions}
                  onChange={(c: string) => setColorMode(c as ColorMode)}
                />
              </div>
              <p className="new-design__advanced-note" role="note">
                Print documents store CMYK/ICC intent and are soft-proofed for export; on-screen
                preview always renders in RGB. Bit depth is 8-bit (uint8) — 16-bit rendering is not
                yet supported end-to-end.
              </p>
              {intent === 'print' && (
                <div className="new-design__field-row">
                  <span className="new-design__field-label">DPI</span>
                  <NumberInput value={dpi} onChange={setDpi} min={72} max={600} label="DPI" />
                  <span className="new-design__field-label new-design__field-label--gap">
                    Bleed
                  </span>
                  <NumberInput value={bleed} onChange={setBleed} min={0} max={50} label="Bleed" />
                  <span className="new-design__field-hint">{unit}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
