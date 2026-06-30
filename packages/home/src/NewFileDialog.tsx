import type { ColorMode, NewDocPreset, Unit } from '@strata/platform';
import { Button, Dialog, NumberInput, SegmentedControl, type SegmentedOption } from '@strata/ui';
import { useCallback, useState } from 'react';
import { TemplatesGallery } from './TemplatesGallery';

export interface NewFileDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (preset: NewDocPreset) => void;
}

const PRESETS: NewDocPreset[] = [
  {
    id: 'blank',
    name: 'Blank',
    category: 'blank',
    width: 1920,
    height: 1080,
    unit: 'px',
    colorMode: 'rgb',
  },
  {
    id: 'web-1440',
    name: 'Web (1440px)',
    category: 'ui-kit',
    width: 1440,
    height: 900,
    unit: 'px',
    colorMode: 'rgb',
  },
  {
    id: 'web-1024',
    name: 'Web (1024px)',
    category: 'ui-kit',
    width: 1024,
    height: 768,
    unit: 'px',
    colorMode: 'rgb',
  },
  {
    id: 'iphone-15',
    name: 'iPhone 15 Pro',
    category: 'device',
    width: 393,
    height: 852,
    unit: 'px',
    colorMode: 'rgb',
  },
  {
    id: 'ipad-air',
    name: 'iPad Air',
    category: 'device',
    width: 820,
    height: 1180,
    unit: 'px',
    colorMode: 'rgb',
  },
  {
    id: 'a4',
    name: 'A4',
    category: 'print',
    width: 210,
    height: 297,
    unit: 'mm',
    colorMode: 'cmyk',
    bleed: 3,
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
  },
  {
    id: 'instagram',
    name: 'Instagram Post',
    category: 'social',
    width: 1080,
    height: 1080,
    unit: 'px',
    colorMode: 'rgb',
  },
  {
    id: 'instagram-story',
    name: 'Instagram Story',
    category: 'social',
    width: 1080,
    height: 1920,
    unit: 'px',
    colorMode: 'rgb',
  },
  {
    id: 'facebook-cover',
    name: 'Facebook Cover',
    category: 'social',
    width: 1640,
    height: 624,
    unit: 'px',
    colorMode: 'rgb',
  },
  {
    id: 'presentation',
    name: 'Presentation (16:9)',
    category: 'blank',
    width: 1920,
    height: 1080,
    unit: 'px',
    colorMode: 'rgb',
  },
];

const categoryOptions: SegmentedOption<string>[] = [
  { value: 'all', label: 'All' },
  { value: 'blank', label: 'Blank' },
  { value: 'device', label: 'Device' },
  { value: 'print', label: 'Print' },
  { value: 'social', label: 'Social' },
  { value: 'ui-kit', label: 'UI' },
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

export function NewFileDialog({ open, onClose, onCreate }: NewFileDialogProps) {
  const [activeTab, setActiveTab] = useState<'presets' | 'template'>('presets');
  const [category, setCategory] = useState('all');
  const [selectedPreset, setSelectedPreset] = useState<NewDocPreset>(PRESETS[0] ?? {
    id: 'blank',
    name: 'Blank',
    category: 'blank',
    width: 1920,
    height: 1080,
    unit: 'px',
    colorMode: 'rgb',
  });
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);
  const [unit, setUnit] = useState<Unit>('px');
  const [colorMode, setColorMode] = useState<ColorMode>('rgb');
  const [bleed, setBleed] = useState(0);

  const filtered = category === 'all' ? PRESETS : PRESETS.filter((p) => p.category === category);

  const getFinalPreset = useCallback((): NewDocPreset => {
    if (selectedPreset.id === 'blank') {
      return {
        id: 'custom',
        name: 'Custom',
        category: 'blank',
        width: customW,
        height: customH,
        unit,
        colorMode,
        bleed: colorMode === 'cmyk' ? bleed || 3 : undefined,
      };
    }
    return selectedPreset;
  }, [selectedPreset, customW, customH, unit, colorMode, bleed]);

  const handleCreate = useCallback(() => {
    onCreate(getFinalPreset());
  }, [onCreate, getFinalPreset]);

  return (
    <Dialog open={open} onClose={onClose} title="New file">
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <button
          type="button"
          style={{
            flex: 1,
            padding: 'var(--space-2)',
            background:
              activeTab === 'presets' ? 'var(--color-interactive-default)' : 'transparent',
            color:
              activeTab === 'presets' ? 'var(--color-text-on-accent)' : 'var(--color-text-primary)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('presets')}
        >
          Presets
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: 'var(--space-2)',
            background:
              activeTab === 'template' ? 'var(--color-interactive-default)' : 'transparent',
            color:
              activeTab === 'template'
                ? 'var(--color-text-on-accent)'
                : 'var(--color-text-primary)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('template')}
        >
          Templates
        </button>
      </div>

      {activeTab === 'presets' && (
        <div>
          <SegmentedControl
            label="Category"
            value={category}
            options={categoryOptions}
            onChange={setCategory}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))',
              gap: 'var(--space-2)',
              margin: 'var(--space-3) 0',
            }}
          >
            {filtered.map((preset) => (
              <button
                key={preset.id}
                type="button"
                style={{
                  padding: 'var(--space-2)',
                  border: `1px solid ${selectedPreset.id === preset.id ? 'var(--color-interactive-default)' : 'var(--color-border-subtle)'}`,
                  borderRadius: 'var(--radius-md)',
                  background:
                    selectedPreset.id === preset.id
                      ? 'var(--color-interactive-default)'
                      : 'transparent',
                  color:
                    selectedPreset.id === preset.id
                      ? 'var(--color-text-on-accent)'
                      : 'var(--color-text-primary)',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
                onClick={() => setSelectedPreset(preset)}
              >
                <div
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-medium)',
                  }}
                >
                  {preset.name}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7 }}>
                  {preset.width} &times; {preset.height} {preset.unit}
                </div>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <label
                htmlFor="custom-width"
                style={{ width: '4rem', fontSize: 'var(--font-size-sm)' }}
              >
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
              <label
                htmlFor="custom-height"
                style={{ width: '4rem', fontSize: 'var(--font-size-sm)' }}
              >
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
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span style={{ width: '4rem', fontSize: 'var(--font-size-sm)' }}>Unit</span>
              <SegmentedControl
                label="Unit"
                value={unit}
                options={unitOptions}
                onChange={(u: string) => setUnit(u as Unit)}
              />
              <span
                style={{
                  width: 'auto',
                  fontSize: 'var(--font-size-sm)',
                  marginLeft: 'var(--space-2)',
                }}
              >
                Color
              </span>
              <SegmentedControl
                label="Color mode"
                value={colorMode}
                options={colorModeOptions}
                onChange={(c: string) => setColorMode(c as ColorMode)}
              />
            </div>
            {colorMode === 'cmyk' && (
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <span style={{ width: '4rem', fontSize: 'var(--font-size-sm)' }}>Bleed</span>
                <NumberInput value={bleed} onChange={setBleed} min={0} max={50} label="Bleed" />
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  {unit}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'template' && (
        <TemplatesGallery
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
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--space-2)',
          marginTop: 'var(--space-4)',
        }}
      >
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleCreate}>
          Create
        </Button>
      </div>
    </Dialog>
  );
}
