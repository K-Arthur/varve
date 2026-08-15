import type { ManagedColor } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { useCallback, useRef, useState } from 'react';
import { Tooltip } from '../Tooltip';
import type { Color } from './color-utils';
import { rgbToHex } from './color-utils';

export interface SwatchPaletteProps {
  /** Canonical ManagedColor swatches (document colors, recents). */
  onSelect: (color: ManagedColor) => void;
  documentColors?: ManagedColor[];
  recentColors?: ManagedColor[];
  label?: string;
}

const THEME_PALETTE: { name: string; color: Color }[] = [
  { name: 'White', color: [255, 255, 255, 255] },
  { name: 'Light Gray', color: [230, 230, 230, 255] },
  { name: 'Gray', color: [150, 150, 150, 255] },
  { name: 'Dark Gray', color: [80, 80, 80, 255] },
  { name: 'Black', color: [0, 0, 0, 255] },
  { name: 'Red 500', color: [220, 38, 38, 255] },
  { name: 'Orange 500', color: [234, 88, 12, 255] },
  { name: 'Yellow 500', color: [202, 138, 4, 255] },
  { name: 'Green 500', color: [22, 163, 74, 255] },
  { name: 'Teal 500', color: [20, 184, 166, 255] },
  { name: 'Blue 500', color: [37, 99, 235, 255] },
  { name: 'Purple 500', color: [124, 58, 237, 255] },
  { name: 'Pink 500', color: [219, 39, 119, 255] },
  { name: 'Brown 500', color: [120, 70, 40, 255] },
];

const SWATCH_SIZE = 24;

function luminance(c: Color): number {
  return c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
}

function swatchBorder(c: Color): string {
  return luminance(c) > 160
    ? '1px solid var(--color-border-strong)'
    : '1px solid rgba(255,255,255,0.3)';
}

/** 8-bit display tuple of a canonical color — swatch face only. */
function displayTuple(c: ManagedColor): Color {
  return managedColorToRgba(c) as unknown as Color;
}

export function SwatchPalette({
  onSelect,
  documentColors,
  recentColors,
  label = 'Colors',
}: SwatchPaletteProps) {
  const listRef = useRef<HTMLDivElement>(null);
  // WCAG 4.1.2 (2026-08-10): track the last-picked swatch so role="option"
  // elements carry a real aria-selected instead of a hardcoded false.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const items = Array.from(
      listRef.current?.querySelectorAll('[role="option"]') ?? [],
    ) as HTMLElement[];
    const idx = items.indexOf(target);
    if (idx === -1) return;
    let nextIdx = idx;
    const cols = Math.floor((listRef.current?.clientWidth ?? 140) / (SWATCH_SIZE + 4));
    switch (e.key) {
      case 'ArrowRight':
        nextIdx = Math.min(items.length - 1, idx + 1);
        break;
      case 'ArrowLeft':
        nextIdx = Math.max(0, idx - 1);
        break;
      case 'ArrowDown':
        nextIdx = Math.min(items.length - 1, idx + cols);
        break;
      case 'ArrowUp':
        nextIdx = Math.max(0, idx - cols);
        break;
      case 'Home':
        nextIdx = 0;
        break;
      case 'End':
        nextIdx = items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    items[nextIdx]?.focus();
  }, []);

  interface SwatchSectionProps {
    title: string;
    colors: { name: string; display: Color; value: ManagedColor }[];
  }

  function SwatchSection({ title, colors }: SwatchSectionProps) {
    return (
      <div>
        <div className="swatch-palette__section-title">{title}</div>
        <div className="swatch-palette__grid">
          {colors.map(({ name, display, value }) => {
            const key = `${name}-${display.join(',')}`;
            return (
              <Tooltip key={key} label={name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedKey === key}
                  aria-label={name}
                  className="swatch-palette__swatch"
                  onClick={() => {
                    setSelectedKey(key);
                    onSelect(value);
                  }}
                  style={{
                    background: `rgba(${display[0]},${display[1]},${display[2]},${(display[3] / 255).toFixed(2)})`,
                    border: swatchBorder(display),
                  }}
                />
              </Tooltip>
            );
          })}
        </div>
      </div>
    );
  }

  const recentSwatches = (recentColors ?? []).map((c) => {
    const display = displayTuple(c);
    return { name: rgbToHex(display[0], display[1], display[2]), display, value: c };
  });

  const docSwatches = (documentColors ?? []).map((c) => {
    const display = displayTuple(c);
    return { name: rgbToHex(display[0], display[1], display[2]), display, value: c };
  });

  const themeSwatches: { name: string; display: Color; value: ManagedColor }[] = THEME_PALETTE.map(
    ({ name, color }) => ({
      name,
      display: color,
      value: {
        space: 'rgb',
        r: color[0],
        g: color[1],
        b: color[2],
        a: color[3],
      },
    }),
  );

  return (
    <div
      ref={listRef}
      className="swatch-palette"
      role="listbox"
      aria-label={label}
      onKeyDown={handleKeyDown}
    >
      {docSwatches.length > 0 && <SwatchSection title="Document Colors" colors={docSwatches} />}
      {recentSwatches.length > 0 && <SwatchSection title="Recent Colors" colors={recentSwatches} />}
      <SwatchSection title="Theme Palette" colors={themeSwatches} />
    </div>
  );
}
