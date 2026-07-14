import type { BrushPreset } from '@strata/scene';
import { defaultBrushPreset } from '@strata/scene';
import { useState } from 'react';
import { useEditor } from '../../../context';

interface BrushSectionProps {
  tool: 'paint' | 'eraser';
}

export function BrushSection({ tool }: BrushSectionProps) {
  const { setTool } = useEditor();
  const isEraser = tool === 'eraser';
  const [preset] = useState<BrushPreset>(() =>
    defaultBrushPreset(
      isEraser ? 'eraser-brush' : 'paint-brush',
      isEraser ? 'Eraser' : 'Paint Brush',
    ),
  );

  return (
    <div className="insp-panel__section">
      <div className="insp-panel__section-header">{isEraser ? 'Eraser' : 'Brush'}</div>
      <div className="insp-field">
        <span className="insp-field__label">Preview</span>
        <div className="insp-field__control">
          <div
            style={{
              width: Math.min(preset.radius * 2, 64),
              height: Math.min(preset.radius * 2, 64),
              borderRadius: '50%',
              background: isEraser
                ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px'
                : 'var(--color-text-primary)',
              opacity: preset.opacity,
              margin: '4px auto',
            }}
            role="img"
            aria-label={`Brush preview, ${Math.round(preset.radius)}px`}
          />
        </div>
      </div>
      <div className="insp-field">
        <span className="insp-field__label">Size</span>
        <div className="insp-field__control">
          <input
            type="range"
            className="insp-slider"
            min={1}
            max={500}
            value={preset.radius}
            aria-label="Brush size"
            onChange={(e) => {
              preset.radius = Number(e.target.value);
            }}
          />
          <span className="insp-field__value">{Math.round(preset.radius)}px</span>
        </div>
      </div>
      <div className="insp-field">
        <span className="insp-field__label">Opacity</span>
        <div className="insp-field__control">
          <input
            type="range"
            className="insp-slider"
            min={0}
            max={100}
            value={preset.opacity * 100}
            aria-label="Brush opacity"
            onChange={(e) => {
              preset.opacity = Number(e.target.value) / 100;
            }}
          />
          <span className="insp-field__value">{Math.round(preset.opacity * 100)}%</span>
        </div>
      </div>
      <div className="insp-field">
        <span className="insp-field__label">Flow</span>
        <div className="insp-field__control">
          <input
            type="range"
            className="insp-slider"
            min={0}
            max={100}
            value={preset.flow * 100}
            aria-label="Brush flow"
            onChange={(e) => {
              preset.flow = Number(e.target.value) / 100;
            }}
          />
          <span className="insp-field__value">{Math.round(preset.flow * 100)}%</span>
        </div>
      </div>
      <div className="insp-field">
        <span className="insp-field__label">Hardness</span>
        <div className="insp-field__control">
          <input
            type="range"
            className="insp-slider"
            min={0}
            max={100}
            value={preset.hardness * 100}
            aria-label="Brush hardness"
            onChange={(e) => {
              preset.hardness = Number(e.target.value) / 100;
            }}
          />
          <span className="insp-field__value">{Math.round(preset.hardness * 100)}%</span>
        </div>
      </div>
      <div className="insp-field">
        <span className="insp-field__label">Smoothing</span>
        <div className="insp-field__control">
          <input
            type="range"
            className="insp-slider"
            min={0}
            max={100}
            value={preset.smoothing * 100}
            aria-label="Brush smoothing"
            onChange={(e) => {
              preset.smoothing = Number(e.target.value) / 100;
            }}
          />
          <span className="insp-field__value">{Math.round(preset.smoothing * 100)}%</span>
        </div>
      </div>
      <div className="insp-field">
        <span className="insp-field__label">Spacing</span>
        <div className="insp-field__control">
          <input
            type="range"
            className="insp-slider"
            min={1}
            max={100}
            value={preset.spacing * 100}
            aria-label="Brush spacing"
            onChange={(e) => {
              preset.spacing = Number(e.target.value) / 100;
            }}
          />
          <span className="insp-field__value">{Math.round(preset.spacing * 100)}%</span>
        </div>
      </div>
      <div className="insp-field">
        <button
          type="button"
          className="insp-field__reset-btn"
          onClick={() => setTool('select')}
          aria-label="Switch to select tool"
        >
          Switch to Select (V)
        </button>
      </div>
    </div>
  );
}
