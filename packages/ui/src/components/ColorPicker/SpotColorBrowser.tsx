import { useMemo, useState } from 'react';
import type { ManagedColor } from '@strata/scene';

const SPOT_COLORS: { name: string; c: number; m: number; y: number; k: number; family: string }[] = [
  { name: 'Pantone 185 C', c: 0, m: 255, y: 255, k: 0, family: 'Pantone Red' },
  { name: 'Pantone 200 C', c: 0, m: 255, y: 230, k: 51, family: 'Pantone Red' },
  { name: 'Pantone 300 C', c: 255, m: 102, y: 0, k: 0, family: 'Pantone Blue' },
  { name: 'Pantone 301 C', c: 255, m: 128, y: 26, k: 26, family: 'Pantone Blue' },
  { name: 'Pantone 375 C', c: 102, m: 0, y: 255, k: 0, family: 'Pantone Green' },
  { name: 'Pantone 376 C', c: 128, m: 26, y: 255, k: 26, family: 'Pantone Green' },
  { name: 'Pantone 123 C', c: 0, m: 77, y: 255, k: 0, family: 'Pantone Yellow' },
  { name: 'Pantone 124 C', c: 0, m: 102, y: 255, k: 26, family: 'Pantone Yellow' },
  { name: 'Pantone 423 C', c: 0, m: 0, y: 0, k: 179, family: 'Pantone Cool Gray' },
  { name: 'Pantone 424 C', c: 0, m: 0, y: 0, k: 128, family: 'Pantone Cool Gray' },
  { name: 'Pantone 4525 C', c: 51, m: 77, y: 153, k: 77, family: 'Pantone Earth' },
  { name: 'Pantone 4625 C', c: 102, m: 153, y: 204, k: 102, family: 'Pantone Earth' },
  { name: 'Pantone 485 C', c: 0, m: 255, y: 255, k: 26, family: 'Pantone Red' },
  { name: 'Pantone 542 C', c: 179, m: 77, y: 0, k: 26, family: 'Pantone Blue' },
  { name: 'Pantone 577 C', c: 153, m: 51, y: 179, k: 26, family: 'Pantone Green' },
];

export interface SpotColorBrowserProps {
  onSelect: (color: ManagedColor) => void;
}

export function SpotColorBrowser({ onSelect }: SpotColorBrowserProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return SPOT_COLORS;
    const q = query.toLowerCase();
    return SPOT_COLORS.filter(
      (s) => s.name.toLowerCase().includes(q) || s.family.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="spot-color-browser">
      <div className="insp-field">
        <label className="insp-field__label">Search</label>
        <div className="insp-field__control">
          <input
            type="text"
            className="insp-num__input color-fields__input-full"
            value={query}
            aria-label="Search spot colors"
            placeholder="Search..."
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="spot-color-browser__list" role="listbox" aria-label="Spot colors">
        {filtered.map((spot) => (
          <button
            key={spot.name}
            type="button"
            role="option"
            aria-selected={false}
            aria-label={spot.name}
            title={spot.name}
            className="spot-color-browser__item"
            onClick={() =>
              onSelect({
                space: 'spot',
                name: spot.name,
                tint: 100,
                a: 255,
                processFallback: { c: spot.c, m: spot.m, y: spot.y, k: spot.k },
              })
            }
          >
            <span
              className="spot-color-browser__swatch"
              style={{
                background: `rgb(${255 - spot.c / 1}, ${255 - spot.m / 1}, ${255 - spot.y / 1})`,
              }}
            />
            <span className="spot-color-browser__name">{spot.name}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="spot-color-browser__empty">No spot colors found</div>
        )}
      </div>
    </div>
  );
}
