import { imageTreatmentSchema, isImageTreatmentKind } from '@varve/engine';
import type { Adjustment } from '@varve/scene';
import { NumberField } from '../Inspector/controls/NumberField';

export interface ImageTreatmentEditorProps {
  adjustment: Adjustment;
  onChange: (patch: Partial<Adjustment>) => void;
}

/**
 * Parameter editor shared by Object Filters and Adjustment Layers. The
 * Image Tuning inspector is intentionally a separate multi-selection surface;
 * this component preserves the full schema-backed controls for advanced stacks.
 */
export function ImageTreatmentEditor({ adjustment, onChange }: ImageTreatmentEditorProps) {
  if (!isImageTreatmentKind(adjustment.kind)) return null;
  const schema = imageTreatmentSchema(adjustment.kind);
  const primary = schema.parameters.filter((parameter) => !parameter.advanced);
  const advanced = schema.parameters.filter((parameter) => parameter.advanced);
  const parameterValue = (key: string, fallback: number) => {
    const value = (adjustment as unknown as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  const control = (parameter: (typeof schema.parameters)[number]) => {
    const value = parameterValue(parameter.key, parameter.defaultValue);
    const unit = parameter.unit;
    const formattedValue = unit ? `${value}${unit === '%' ? '%' : ` ${unit}`}` : String(value);
    return (
      <div className="adj-editor__parameter" key={parameter.key}>
        <div className="adj-editor__parameter-label">
          <span>{parameter.label}</span>
          <output>{formattedValue}</output>
        </div>
        <div className="adj-editor__parameter-controls">
          <input
            type="range"
            className="adj-editor__slider"
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            value={value}
            aria-label={`${parameter.label} slider`}
            aria-description={parameter.description}
            onChange={(event) =>
              onChange({ [parameter.key]: Number(event.target.value) } as Partial<Adjustment>)
            }
          />
          <div className="adj-editor__parameter-value">
            <NumberField
              label={`${parameter.label} value`}
              displayLabel="Value"
              value={value}
              min={parameter.min}
              max={parameter.max}
              step={parameter.step}
              altStep={parameter.fineStep}
              shiftStep={parameter.step * 10}
              unit={unit}
              onChange={(next) => onChange({ [parameter.key]: next } as Partial<Adjustment>)}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <fieldset
      aria-describedby={`image-treatment-editor-${adjustment.kind}-description`}
      className="adj-editor__group adj-editor__treatment-group"
      data-image-treatment-editor={adjustment.kind}
    >
      <legend className="sr-only">{schema.label} controls</legend>
      <p className="adj-editor__hint" id={`image-treatment-editor-${adjustment.kind}-description`}>
        {schema.description}
      </p>
      {primary.map(control)}
      {advanced.length > 0 && (
        <details className="adj-editor__advanced">
          <summary>Advanced {schema.label} settings</summary>
          {advanced.map(control)}
        </details>
      )}
    </fieldset>
  );
}
