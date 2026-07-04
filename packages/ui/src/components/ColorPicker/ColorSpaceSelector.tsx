export type ColorSpace = 'rgb' | 'cmyk' | 'gray' | 'spot';

const SPACES: { key: ColorSpace; label: string }[] = [
  { key: 'rgb', label: 'RGB' },
  { key: 'cmyk', label: 'CMYK' },
  { key: 'gray', label: 'Grayscale' },
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
        <button
          key={s.key}
          type="button"
          className={`color-fields__mode-btn${active === s.key ? ' color-fields__mode-btn--active' : ''}`}
          aria-pressed={active === s.key}
          onClick={() => onChange(s.key)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
