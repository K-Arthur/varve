import { BUILT_IN_BRUSH_PRESETS, defaultBrushPreset, validateBrushPreset } from '@strata/scene';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';

interface BrushSectionProps {
  tool: 'paint' | 'eraser';
}

const BUILTIN_OPTIONS = Object.values(BUILT_IN_BRUSH_PRESETS).map((p) => ({
  id: p.id,
  name: p.name,
}));

export function BrushSection({ tool }: BrushSectionProps) {
  const { state, setBrushSetting } = useEditor();
  const isEraser = tool === 'eraser';
  const { brushSettings } = state;

  const heading = isEraser ? 'Eraser' : 'Brush';

  const handlePresetChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const presetId = e.target.value;
      if (!presetId) return;

      const found = validateBrushPreset(
        BUILT_IN_BRUSH_PRESETS[presetId] ?? defaultBrushPreset(presetId, presetId),
      );
      if (!found) return;

      setBrushSetting('presetId', found.id);
      setBrushSetting('radius', found.radius);
      setBrushSetting('opacity', found.opacity);
      setBrushSetting('flow', found.flow);
      setBrushSetting('hardness', found.hardness);
      setBrushSetting('smoothing', found.smoothing);
      setBrushSetting('spacing', found.spacing);
    },
    [setBrushSetting],
  );

  return (
    <DisclosureSection title={heading}>
      <div className="insp-field">
        <span className="insp-field__label">Preset</span>
        <div className="insp-field__control">
          <select
            className="insp-select"
            value={brushSettings.presetId}
            onChange={handlePresetChange}
            aria-label="Brush preset"
          >
            {BUILTIN_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="insp-field">
        <span className="insp-field__label">Preview</span>
        <div className="insp-field__control">
          <div
            style={{
              width: Math.min(brushSettings.radius * 2, 64),
              height: Math.min(brushSettings.radius * 2, 64),
              borderRadius: '50%',
              background: isEraser
                ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px'
                : 'var(--color-text-primary)',
              opacity: brushSettings.opacity,
              margin: '4px auto',
            }}
            role="img"
            aria-label={`Brush preview, ${Math.round(brushSettings.radius)}px`}
          />
        </div>
      </div>

      <NumberField
        label="Size"
        value={brushSettings.radius}
        min={1}
        max={1000}
        step={1}
        shiftStep={10}
        unit="px"
        onChange={(v) => setBrushSetting('radius', v)}
      />

      <NumberField
        label="Opacity"
        value={Math.round(brushSettings.opacity * 100)}
        min={0}
        max={100}
        step={1}
        shiftStep={10}
        unit="%"
        onChange={(v) => setBrushSetting('opacity', v / 100)}
      />

      <NumberField
        label="Flow"
        value={Math.round(brushSettings.flow * 100)}
        min={0}
        max={100}
        step={1}
        shiftStep={10}
        unit="%"
        onChange={(v) => setBrushSetting('flow', v / 100)}
      />

      <NumberField
        label="Hardness"
        value={Math.round(brushSettings.hardness * 100)}
        min={0}
        max={100}
        step={1}
        shiftStep={10}
        unit="%"
        onChange={(v) => setBrushSetting('hardness', v / 100)}
      />

      <NumberField
        label="Smoothing"
        value={Math.round(brushSettings.smoothing * 100)}
        min={0}
        max={100}
        step={1}
        shiftStep={10}
        unit="%"
        onChange={(v) => setBrushSetting('smoothing', v / 100)}
      />

      {(tool === 'paint' || tool === 'eraser') && (
        <NumberField
          label="Spacing"
          value={Math.round(brushSettings.spacing * 100)}
          min={1}
          max={100}
          step={1}
          shiftStep={10}
          unit="%"
          onChange={(v) => setBrushSetting('spacing', Math.max(0.01, v / 100))}
        />
      )}
    </DisclosureSection>
  );
}
