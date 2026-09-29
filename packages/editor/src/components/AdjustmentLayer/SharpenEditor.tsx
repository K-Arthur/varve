import type { Adjustment, AdjustmentNode, Document } from '@varve/scene';
import { Button, Select, Switch } from '@varve/ui';
import { SharpenDetail } from './SharpenDetail';
import { TonalSlider } from './TonalSlider';
import './tonalEditors.css';

export function SharpenEditor({
  adjustment,
  onChange,
  doc,
  detailScope,
}: {
  adjustment: Adjustment;
  onChange: (patch: Partial<Adjustment>) => void;
  doc?: Document;
  detailScope?: AdjustmentNode;
}) {
  if (adjustment.kind !== 'sharpen') return null;
  const current = adjustment.algorithmVersion === 2;
  return (
    <div className="tonal-editor">
      <Select
        label="Sharpen algorithm"
        value={current ? '2' : '1'}
        options={[
          { value: '1', label: 'Legacy box (saved appearance)' },
          { value: '2', label: 'Gaussian unsharp mask' },
        ]}
        onChange={(value) =>
          onChange({ algorithmVersion: value === '2' ? 2 : 1 } as Partial<Adjustment>)
        }
      />
      <p className="tonal-editor__hint">
        Radius uses target-local units for Object Filters and document units for Adjustment Filters.
        Zoom and display density do not change the authored value. Output sharpening is a separate
        export stage.
      </p>
      <TonalSlider
        label="Sharpen amount"
        value={adjustment.amount}
        min={0}
        max={4096}
        step={1}
        unit="%"
        onChange={(amount) => onChange({ amount } as Partial<Adjustment>)}
      />
      <TonalSlider
        label="Sharpen radius"
        value={adjustment.radius}
        min={0}
        max={64}
        step={0.1}
        unit="units"
        onChange={(radius) => onChange({ radius } as Partial<Adjustment>)}
      />
      <TonalSlider
        label="Sharpen threshold"
        value={adjustment.threshold}
        min={0}
        max={255}
        step={0.1}
        onChange={(threshold) => onChange({ threshold } as Partial<Adjustment>)}
      />
      {current && (
        <>
          <Select
            label="Sharpen working domain"
            value={adjustment.workingSpace ?? 'linear-srgb'}
            options={[
              { value: 'linear-srgb', label: 'Linear sRGB' },
              { value: 'srgb', label: 'Encoded sRGB' },
            ]}
            onChange={(workingSpace) => onChange({ workingSpace } as Partial<Adjustment>)}
          />
          <Switch
            label="Luma-only correction"
            checked={adjustment.luminanceOnly ?? false}
            onChange={(e) => onChange({ luminanceOnly: e.target.checked } as Partial<Adjustment>)}
          />
          <Switch
            label="Reduce correction at partial alpha"
            checked={adjustment.protectAlpha ?? true}
            onChange={(e) => onChange({ protectAlpha: e.target.checked } as Partial<Adjustment>)}
          />
          <p className="tonal-editor__hint">
            Radius is the Gaussian three-sigma support. Threshold is 0–255 relative to the selected
            domain. Luma-only adds the same component delta; clipping can change color. Alpha is
            preserved. Large amount/radius can amplify noise and halos.
          </p>
        </>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange({ amount: 0 } as Partial<Adjustment>)}
      >
        Reset sharpening
      </Button>
      <SharpenDetail doc={doc} scope={detailScope} adjustment={adjustment} />
    </div>
  );
}
