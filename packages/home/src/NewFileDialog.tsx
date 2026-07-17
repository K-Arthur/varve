import type { ColorMode, NewDocPreset, TemplateLibrary, Unit } from '@strata/platform';
import { Button, Dialog, NumberInput, SegmentedControl, type SegmentedOption } from '@strata/ui';
import { useCallback, useState } from 'react';
import { TemplatesGallery } from './TemplatesGallery';

export interface NewFileDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (preset: NewDocPreset) => void;
  templates?: TemplateLibrary[];
  onSaveAsTemplate?: () => void;
}

/**
 * Document-level presets only. Following the Figma model, device / social /
 * web sizes are NOT chosen up front — they are frame presets applied inside the
 * editor. The modal offers a blank canvas (custom size) plus print documents,
 * which are genuinely document-level because CMYK colour + bleed are document
 * properties that do not map onto individual frames.
 */
const BLANK_PRESET: NewDocPreset = {
  id: 'blank',
  name: 'Blank',
  category: 'blank',
  width: 1920,
  height: 1080,
  unit: 'px',
  colorMode: 'rgb',
};

const PRINT_PRESETS: NewDocPreset[] = [
  {
    id: 'a4',
    name: 'A4',
    category: 'print',
    width: 210,
    height: 297,
    unit: 'mm',
    colorMode: 'cmyk',
    bleed: 3,
    dpi: 300,
  },
  {
    id: 'a3',
    name: 'A3',
    category: 'print',
    width: 297,
    height: 420,
    unit: 'mm',
    colorMode: 'cmyk',
    bleed: 3,
    dpi: 300,
  },
  {
    id: 'us-letter',
    name: 'US Letter',
    category: 'print',
    width: 215.9,
    height: 279.4,
    unit: 'mm',
    colorMode: 'cmyk',
    bleed: 3,
    dpi: 300,
  },
];

const unitOptions: SegmentedOption<Unit>[] = [
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
}: NewFileDialogProps) {
  const [activeTab, setActiveTab] = useState<'blank' | 'template'>('blank');
  const [selectedId, setSelectedId] = useState('blank');
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);
  const [unit, setUnit] = useState<Unit>('px');
  const [colorMode, setColorMode] = useState<ColorMode>('rgb');
  const [bleed, setBleed] = useState(0);
  const [dpi, setDpi] = useState(300);

  // Selecting a preset fills the size fields so the numeric controls always
  // reflect what Create will produce.
  const selectPreset = useCallback((preset: NewDocPreset) => {
    setSelectedId(preset.id);
    setCustomW(preset.width);
    setCustomH(preset.height);
    setUnit(preset.unit);
    setColorMode(preset.colorMode);
    setBleed(preset.bleed ?? 0);
    setDpi(preset.dpi ?? 300);
  }, []);

  const getFinalPreset = useCallback((): NewDocPreset => {
    const base =
      selectedId === 'blank'
        ? BLANK_PRESET
        : (PRINT_PRESETS.find((p) => p.id === selectedId) ?? BLANK_PRESET);
    return {
      id: selectedId === 'blank' ? 'custom' : selectedId,
      name: base.name,
      category: base.category,
      width: customW,
      height: customH,
      unit,
      colorMode,
      bleed: colorMode === 'cmyk' ? bleed || 3 : undefined,
      dpi: colorMode === 'cmyk' ? dpi : undefined,
    };
  }, [selectedId, customW, customH, unit, colorMode, bleed, dpi]);

  const handleCreate = useCallback(() => {
    onCreate(getFinalPreset());
  }, [onCreate, getFinalPreset]);

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
            className={`new-file__blank${selectedId === 'blank' ? ' new-file__blank--active' : ''}`}
            onClick={() => selectPreset(BLANK_PRESET)}
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
                Start empty at any size. Add device/social frames later.
              </span>
            </span>
          </button>

          <div className="new-file__section-label">Print document</div>
          <div className="new-file__print-grid">
            {PRINT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`new-file__print${selectedId === preset.id ? ' new-file__print--active' : ''}`}
                onClick={() => selectPreset(preset)}
              >
                <span className="new-file__print-name">{preset.name}</span>
                <span className="new-file__print-size">
                  {preset.width} &times; {preset.height} {preset.unit}
                </span>
                <span className="new-file__print-badge">CMYK</span>
              </button>
            ))}
          </div>

          <div className="new-file__fields">
            <div className="new-file__field-row">
              <label htmlFor="custom-width" className="new-file__field-label">
                Width
              </label>
              <NumberInput
                value={customW}
                onChange={setCustomW}
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
                onChange={setCustomH}
                min={1}
                max={10000}
                label="Height"
                id="custom-height"
              />
            </div>
            <div className="new-file__field-row">
              <span className="new-file__field-label">Unit</span>
              <SegmentedControl
                label="Unit"
                value={unit}
                options={unitOptions}
                onChange={(u: string) => setUnit(u as Unit)}
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
