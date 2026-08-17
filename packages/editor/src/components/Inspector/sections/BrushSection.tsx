import { BUILT_IN_BRUSH_PRESETS, defaultBrushPreset, validateBrushPreset } from '@varve/scene';
import { Select } from '@varve/ui';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';
import type { SectionId } from '../sectionRegistry';

interface BrushSectionProps {
  tool: 'paint' | 'eraser' | 'pencil' | 'smudge';
  sectionId?: SectionId;
}

const BUILTIN_OPTIONS = Object.values(BUILT_IN_BRUSH_PRESETS).map((p) => ({
  id: p.id,
  name: p.name,
}));

export function BrushSection({ tool, sectionId }: BrushSectionProps) {
  const { state, setBrushSetting } = useEditor();
  const isEraser = tool === 'eraser';
  const isPencil = tool === 'pencil';
  const isSmudge = tool === 'smudge';
  const { brushSettings } = state;

  const heading = isPencil ? 'Pencil' : isEraser ? 'Eraser' : isSmudge ? 'Smudge' : 'Brush';

  // The pencil tool draws vector strokes: preset/radius/opacity/flow/hardness/
  // spacing are raster-brush concepts that don't apply. Only stroke
  // stabilization (smoothing) carries over — it drives PencilTool's stabilizer.
  if (isPencil) {
    return (
      <DisclosureSection title={heading} sectionId={sectionId}>
        <NumberField
          label="Stabilization"
          value={Math.round(brushSettings.smoothing * 100)}
          min={0}
          max={100}
          step={1}
          shiftStep={10}
          unit="%"
          onChange={(v) => setBrushSetting('smoothing', v / 100)}
        />
      </DisclosureSection>
    );
  }

  const handlePresetChange = useCallback(
    (presetId: string) => {
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
      setBrushSetting('grainId', found.grainId ?? null);
      setBrushSetting('grainScale', found.grainScale);
      setBrushSetting('grainRotation', found.grainRotation);
      setBrushSetting('grainContrast', found.grainContrast);
      setBrushSetting('grainInvert', found.grainInvert);
    },
    [setBrushSetting],
  );

  return (
    <DisclosureSection title={heading} sectionId={sectionId}>
      <div className="insp-field">
        <span className="insp-field__label">Preset</span>
        <div className="insp-field__control">
          <Select
            label="Brush preset"
            value={brushSettings.presetId}
            options={BUILTIN_OPTIONS.map((opt) => ({ value: opt.id, label: opt.name }))}
            onChange={handlePresetChange}
          />
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
                : isSmudge
                  ? 'linear-gradient(135deg, var(--color-accent-primary) 0%, var(--color-text-muted) 100%)'
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

      {(tool === 'paint' || tool === 'eraser' || tool === 'smudge') && (
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

      {isSmudge && (
        <NumberField
          label="Strength"
          value={Math.round(brushSettings.smudgeStrength * 100)}
          min={0}
          max={100}
          step={1}
          shiftStep={10}
          unit="%"
          onChange={(v) => setBrushSetting('smudgeStrength', v / 100)}
        />
      )}
    </DisclosureSection>
  );
}
