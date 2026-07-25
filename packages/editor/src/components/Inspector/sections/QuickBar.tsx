/**
 * QuickBar — persistent compact controls for the 6 most-edited properties.
 *
 * Shown only for single selection. Provides immediate access to position
 * (X/Y), size (W/H), opacity, and primary fill color without expanding
 * disclosure sections. Reduces the need to scroll through sections for
 * routine adjustments.
 *
 * Research basis: Figma's persistent transform handles; APG Spinbutton.
 */

import type { ManagedColor, SceneNode } from '@strata/scene';
import { useCallback, useEffect, useState } from 'react';
import { useEditor } from '../../../context';
import { nodeLocalBounds } from '../../../scene/nodeBounds';
import { parseField } from '../controls/NumberField';

export function QuickBar({ node }: { node: SceneNode }) {
  const {
    setSelectedX,
    setSelectedY,
    setSelectedW,
    setSelectedH,
    setSelectedOpacity,
    setSelectedFill,
  } = useEditor();

  const bounds = nodeLocalBounds(node);
  const x = node.transform[4] ?? 0;
  const y = node.transform[5] ?? 0;
  const w = bounds?.w ?? 0;
  const h = bounds?.h ?? 0;
  const opacity = node.opacity ?? 1;
  const primaryFill = (node as SceneNode & { fills?: { type: string; color?: ManagedColor }[] })
    .fills?.[0];

  const allSizable = bounds !== null;

  const handleX = useCallback((v: number) => setSelectedX(v), [setSelectedX]);
  const handleY = useCallback((v: number) => setSelectedY(v), [setSelectedY]);
  const handleW = useCallback((v: number) => setSelectedW(v), [setSelectedW]);
  const handleH = useCallback((v: number) => setSelectedH(v), [setSelectedH]);
  const handleOpacity = useCallback((v: number) => setSelectedOpacity(v), [setSelectedOpacity]);

  return (
    <div className="insp-quick-bar">
      <QuickField label="X" value={x} onChange={handleX} unit="px" />
      <QuickField label="Y" value={y} onChange={handleY} unit="px" />
      {allSizable && (
        <>
          <QuickField label="W" value={w} onChange={handleW} unit="px" />
          <QuickField label="H" value={h} onChange={handleH} unit="px" />
        </>
      )}
      <div className="insp-quick-bar__opacity">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={opacity}
          onChange={(e) => handleOpacity(parseFloat(e.target.value))}
          aria-label="Opacity"
        />
      </div>
      {primaryFill?.color && (
        <input
          type="color"
          value={managedColorToHex(primaryFill.color)}
          onChange={(e) => {
            const hex = e.target.value;
            setSelectedFill({
              space: 'rgb',
              r: parseInt(hex.slice(1, 3), 16),
              g: parseInt(hex.slice(3, 5), 16),
              b: parseInt(hex.slice(5, 7), 16),
              a: 255,
            });
          }}
          className="insp-quick-bar__swatch"
          aria-label="Fill color"
        />
      )}
    </div>
  );
}

function QuickField({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  const [local, setLocal] = useState(String(Math.round(value * 100) / 100));

  useEffect(() => {
    setLocal(String(Math.round(value * 100) / 100));
  }, [value]);

  const commit = useCallback(
    (raw: string) => {
      const parsed = parseField(raw, {});
      if (parsed !== null) {
        onChange(parsed);
      } else {
        setLocal(String(Math.round(value * 100) / 100));
      }
    },
    [onChange, value],
  );

  return (
    <div className="insp-quick-bar__field">
      <span className="insp-quick-bar__label">{label}</span>
      <input
        type="text"
        className="insp-quick-bar__input"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(local);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            setLocal(String(Math.round(value * 100) / 100));
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label={`${label}${unit ? ` (${unit})` : ''}`}
      />
    </div>
  );
}

function managedColorToHex(color: ManagedColor): string {
  if (color.space === 'rgb') {
    const r = color.r.toString(16).padStart(2, '0');
    const g = color.g.toString(16).padStart(2, '0');
    const b = color.b.toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return '#000000';
}
