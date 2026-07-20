import type { TemplateLibrary } from '@strata/platform';
import {
  BLANK_DOCUMENT_PRESET,
  BUILTIN_PRESET_GROUPS,
  type ColorMode,
  type CustomPreset,
  type DocumentUnit,
  deriveHeight,
  deriveWidth,
  type Preset,
  simplifyRatio,
} from '@strata/shared';
import {
  Button,
  Checkbox,
  Dialog,
  IconButton,
  NumberInput,
  PresetPicker,
  SegmentedControl,
  type SegmentedOption,
} from '@strata/ui';
import { useCallback, useState } from 'react';
import { TemplatesGallery } from './TemplatesGallery';

export interface NewFileDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (preset: Preset) => void;
  templates?: TemplateLibrary[];
  onSaveAsTemplate?: () => void;
  /** User-created document presets, favorites, and recents — from
   *  usePresetLibrary. The dialog stays presentational; HomeShell owns
   *  persistence, matching the existing onToggleFavorite prop-drilling
   *  convention already used for file favorites. */
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

const unitOptions: SegmentedOption<DocumentUnit>[] = [
  { value: 'px', label: 'px' },
  { value: 'pt', label: 'pt' },
  { value: 'in', label: 'in' },
  { value: 'mm', label: 'mm' },
];

const colorModeOptions: SegmentedOption<ColorMode>[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'cmyk', label: 'CMYK' },
];

export function NewFileDialog({
  open,
  onClose,
  onCreate,
  templates,
  onSaveAsTemplate,
  customPresets,
  favoriteIds,
  recentIds,
  onToggleFavoritePreset,
  onRecordRecentPreset,
  onSaveCustomPreset,
  onEditCustomPreset,
  onDuplicateCustomPreset,
  onDeleteCustomPreset,
}: NewFileDialogProps) {
  const [activeTab, setActiveTab] = useState<'blank' | 'template'>('blank');
  const [selectedPreset, setSelectedPreset] = useState<Preset>(BLANK_DOCUMENT_PRESET);
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);
  const [unit, setUnit] = useState<DocumentUnit>('px');
  const [colorMode, setColorMode] = useState<ColorMode>('rgb');
  const [bleed, setBleed] = useState(0);
  const [dpi, setDpi] = useState(300);
  const [ratioLocked, setRatioLocked] = useState(false);
  const [lockedRatio, setLockedRatio] = useState(() => simplifyRatio(1920, 1080));
  const [savingPresetName, setSavingPresetName] = useState<string | null>(null);

  // Selecting a preset fills the size fields so the numeric controls always
  // reflect what Create will produce.
  const selectPreset = useCallback(
    (preset: Preset) => {
      setSelectedPreset(preset);
      setCustomW(preset.width);
      setCustomH(preset.height);
      setUnit(preset.unit);
      setColorMode(preset.colorMode ?? 'rgb');
      setBleed(preset.bleed?.value ?? 0);
      setDpi(preset.dpi ?? 300);
      setLockedRatio(preset.aspectRatio ?? simplifyRatio(preset.width, preset.height));
      setSavingPresetName(null);
      onRecordRecentPreset?.(preset);
    },
    [onRecordRecentPreset],
  );

  const handleWidthChange = useCallback(
    (value: number) => {
      setCustomW(value);
      if (ratioLocked) setCustomH(deriveHeight(value, lockedRatio));
    },
    [ratioLocked, lockedRatio],
  );

  const handleHeightChange = useCallback(
    (value: number) => {
      setCustomH(value);
      if (ratioLocked) setCustomW(deriveWidth(value, lockedRatio));
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
    setCustomW(customH);
    setCustomH(customW);
    setLockedRatio((r) => ({ w: r.h, h: r.w }));
  }, [customW, customH]);

  const getFinalPreset = useCallback((): Preset => {
    return {
      ...selectedPreset,
      id: selectedPreset.id === BLANK_DOCUMENT_PRESET.id ? 'custom' : selectedPreset.id,
      width: customW,
      height: customH,
      unit,
      orientation: customW === customH ? 'square' : customW > customH ? 'landscape' : 'portrait',
      colorMode,
      bleed: colorMode === 'cmyk' ? { value: bleed || 3, unit } : undefined,
      dpi: colorMode === 'cmyk' ? dpi : undefined,
    };
  }, [selectedPreset, customW, customH, unit, colorMode, bleed, dpi]);

  const handleCreate = useCallback(() => {
    onCreate(getFinalPreset());
  }, [onCreate, getFinalPreset]);

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
      bleed: colorMode === 'cmyk' ? { value: bleed || 3, unit } : undefined,
      dpi: colorMode === 'cmyk' ? dpi : undefined,
    });
    if (!result.error) setSavingPresetName(null);
  }, [savingPresetName, onSaveCustomPreset, customW, customH, unit, colorMode, bleed, dpi]);

  return (
    <Dialog open={open} onClose={onClose} title="New file">
      <div className="new-file__tabs" role="tablist" aria-label="New file source">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'blank'}
          className={`new-file__tab${activeTab === 'blank' ? ' new-file__tab--active' : ''}`}
          onClick={() => setActiveTab('blank')}
        >
          Blank
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'template'}
          className={`new-file__tab${activeTab === 'template' ? ' new-file__tab--active' : ''}`}
          onClick={() => setActiveTab('template')}
        >
          Templates
        </button>
      </div>

      {activeTab === 'blank' && (
        <div className="new-file__body">
          <button
            type="button"
            className={`new-file__blank${selectedPreset.id === BLANK_DOCUMENT_PRESET.id ? ' new-file__blank--active' : ''}`}
            onClick={() => selectPreset(BLANK_DOCUMENT_PRESET)}
          >
            <span className="new-file__blank-icon" aria-hidden>
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <title>Blank canvas</title>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M12 8v8M8 12h8" />
              </svg>
            </span>
            <span className="new-file__blank-text">
              <span className="new-file__blank-title">Blank canvas</span>
              <span className="new-file__blank-sub">
                Start empty at any size, or choose a preset below.
              </span>
            </span>
          </button>

          <div className="new-file__section-label">Presets</div>
          <PresetPicker
            groups={BUILTIN_PRESET_GROUPS}
            customPresets={customPresets}
            recentIds={recentIds}
            favoriteIds={favoriteIds}
            selectedId={selectedPreset.id}
            label="Document presets"
            onSelect={selectPreset}
            onToggleFavorite={onToggleFavoritePreset}
            onEditCustom={onEditCustomPreset}
            onDuplicateCustom={onDuplicateCustomPreset}
            onDeleteCustom={onDeleteCustomPreset}
          />

          <div className="new-file__fields">
            <div className="new-file__field-row">
              <label htmlFor="custom-width" className="new-file__field-label">
                Width
              </label>
              <NumberInput
                value={customW}
                onChange={handleWidthChange}
                min={1}
                max={10000}
                label="Width"
                id="custom-width"
              />
              <label htmlFor="custom-height" className="new-file__field-label">
                Height
              </label>
              <NumberInput
                value={customH}
                onChange={handleHeightChange}
                min={1}
                max={10000}
                label="Height"
                id="custom-height"
              />
            </div>
            <div className="new-file__field-row">
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
            <div className="new-file__field-row">
              <span className="new-file__field-label">Unit</span>
              <SegmentedControl
                label="Unit"
                value={unit}
                options={unitOptions}
                onChange={(u: string) => setUnit(u as DocumentUnit)}
              />
              <span className="new-file__field-label new-file__field-label--gap">Color</span>
              <SegmentedControl
                label="Color mode"
                value={colorMode}
                options={colorModeOptions}
                onChange={(c: string) => setColorMode(c as ColorMode)}
              />
            </div>
            {colorMode === 'cmyk' && (
              <div className="new-file__field-row">
                <span className="new-file__field-label">Bleed</span>
                <NumberInput value={bleed} onChange={setBleed} min={0} max={50} label="Bleed" />
                <span className="new-file__field-hint">{unit}</span>
              </div>
            )}
            {colorMode === 'cmyk' && (
              <div className="new-file__field-row">
                <span className="new-file__field-label">DPI</span>
                <NumberInput value={dpi} onChange={setDpi} min={72} max={600} label="DPI" />
                <span className="new-file__field-hint">resolution</span>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'template' && (
        <div className="new-file__body">
          <TemplatesGallery
            templates={templates}
            showSearch
            onSelect={(template) => {
              onCreate({
                id: template.id,
                name: template.name,
                category: 'blank',
                width: 1920,
                height: 1080,
                unit: 'px',
                orientation: 'landscape',
                colorMode: 'rgb',
              });
              onClose();
            }}
          />
        </div>
      )}

      <div className="new-file__footer">
        <div className="new-file__footer-left">
          {onSaveAsTemplate && (
            <Button variant="ghost" onClick={onSaveAsTemplate}>
              Save as Template
            </Button>
          )}
          {onSaveCustomPreset && activeTab === 'blank' && savingPresetName === null && (
            <Button variant="ghost" onClick={handleSaveCustomPresetClick}>
              Save as preset
            </Button>
          )}
          {onSaveCustomPreset && activeTab === 'blank' && savingPresetName !== null && (
            <div className="new-file__save-preset-row">
              <input
                type="text"
                className="new-file__save-preset-input"
                value={savingPresetName}
                onChange={(e) => setSavingPresetName(e.target.value)}
                aria-label="Preset name"
                autoFocus
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
        <div className="new-file__footer-right">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreate} data-testid="create-file-button">
            Create
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
