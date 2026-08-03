export type ColorSpace = 'rgb' | 'cmyk' | 'gray' | 'spot' | 'lab' | 'lch';

const SPACES: { key: ColorSpace; label: string }[] = [
  { key: 'rgb', label: 'RGB' },
  { key: 'cmyk', label: 'CMYK' },
  { key: 'gray', label: 'Grayscale' },
  { key: 'lab', label: 'Lab' },
  { key: 'lch', label: 'LCH' },
  { key: 'spot', label: 'Spot' },
];

export interface ColorSpaceSelectorProps {
  active: ColorSpace;
  onChange: (space: ColorSpace) => void;
}

export function ColorSpaceSelector({ active, onChange }: ColorSpaceSelectorProps) {
  return (
    <div className="color-fields__mode-group" role="radiogroup" aria-label="Color space">
      {SPACES.map((s) => (
        // biome-ignore lint/a11y/useSemanticElements: APG radiogroup pattern uses role="radio" on buttons for custom segmented controls
        <button
          key={s.key}
          type="button"
          role="radio"
          className={`color-fields__mode-btn${active === s.key ? ' color-fields__mode-btn--active' : ''}`}
          aria-checked={active === s.key}
          onClick={() => onChange(s.key)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
