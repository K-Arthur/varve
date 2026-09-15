import { useRef } from 'react';

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
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let next = -1;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % SPACES.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + SPACES.length) % SPACES.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = SPACES.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    // APG radiogroup: arrows move selection AND focus (roving tabindex).
    onChange(SPACES[next]!.key);
    btnRefs.current[next]?.focus();
  };

  return (
    <div className="color-fields__mode-group" role="radiogroup" aria-label="Color space">
      {SPACES.map((s, i) => (
        // biome-ignore lint/a11y/useSemanticElements: APG radiogroup pattern uses role="radio" on buttons for custom segmented controls
        <button
          key={s.key}
          ref={(el) => {
            btnRefs.current[i] = el;
          }}
          type="button"
          role="radio"
          className={`color-fields__mode-btn${active === s.key ? ' color-fields__mode-btn--active' : ''}`}
          aria-checked={active === s.key}
          tabIndex={active === s.key ? 0 : -1}
          onClick={() => onChange(s.key)}
          onKeyDown={(e) => handleKeyDown(e, i)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
