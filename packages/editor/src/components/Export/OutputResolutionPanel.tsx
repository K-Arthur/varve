import { useId } from 'react';

import './OutputResolutionPanel.css';

const COMMON_PPI = [72, 96, 150, 300, 600] as const;

export interface OutputResolutionPanelProps {
  /** Null means that each saved preset keeps its own scale/resolution. */
  value: number | null;
  onChange: (ppi: number | null) => void;
}

/** Temporary batch override; it never mutates saved per-frame presets. */
export function OutputResolutionPanel({ value, onChange }: OutputResolutionPanelProps) {
  const groupId = useId();
  const customId = useId();
  const useOverride = value !== null;

  return (
    <section className="output-resolution" aria-label="Output resolution">
      <h3 className="output-resolution__title">Raster output resolution</h3>
      <p className="output-resolution__note">
        A temporary PPI override changes output pixels for raster files only. Saved presets and
        source image pixels are unchanged.
      </p>
      <label className="output-resolution__option" htmlFor={`${groupId}-saved`}>
        <input
          id={`${groupId}-saved`}
          type="radio"
          name={groupId}
          checked={!useOverride}
          onChange={() => onChange(null)}
        />
        Use each preset&apos;s resolution
      </label>
      <label className="output-resolution__option" htmlFor={`${groupId}-override`}>
        <input
          id={`${groupId}-override`}
          type="radio"
          name={groupId}
          checked={useOverride}
          onChange={() => onChange(value ?? 300)}
        />
        Override raster outputs
      </label>
      {useOverride && (
        <>
          <fieldset className="output-resolution__presets">
            <legend className="output-resolution__label">Common resolutions</legend>
            {COMMON_PPI.map((ppi) => (
              <button
                key={ppi}
                type="button"
                className="output-resolution__preset"
                aria-pressed={value === ppi}
                onClick={() => onChange(ppi)}
              >
                {ppi} PPI
              </button>
            ))}
          </fieldset>
          <div className="output-resolution__value">
            <label htmlFor={customId}>Custom resolution</label>
            <input
              id={customId}
              type="number"
              min={1}
              max={2400}
              step={1}
              value={value}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next) && next > 0) onChange(Math.min(2400, next));
              }}
              aria-label="Temporary raster output resolution in PPI"
            />
            <span aria-hidden="true">PPI</span>
          </div>
        </>
      )}
      <p className="output-resolution__note">
        Vector, SVG, and PDF content remains vector where supported.
      </p>
    </section>
  );
}
