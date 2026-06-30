/**
 * GradientStopEditor — draggable gradient stops with add/move/delete.
 *
 * P2: Visual editor for gradient stops. Shows a gradient preview bar
 * with draggable stop handles. Click on the bar to add a stop.
 * Double-click a stop to delete it.
 *
 * Research basis: Figma/Sketch gradient stop editors.
 */
import type { Color } from '@strata/engine';
import type { GradientStop } from '@strata/scene';
import { useCallback, useRef, useState } from 'react';

interface GradientStopEditorProps {
  stops: GradientStop[];
  rotation: number;
  onChange: (stops: GradientStop[], rotation: number) => void;
}

export function GradientStopEditor({ stops, rotation, onChange }: GradientStopEditorProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const gradientCss = stops
    .map((s) => {
      const [r, g, b, a] = s.color;
      return `rgba(${r},${g},${b},${(a / 255).toFixed(2)}) ${(s.position * 100).toFixed(1)}%`;
    })
    .join(', ');

  const getPosFromEvent = useCallback((clientX: number): number => {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }, []);

  const handleBarClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't add if clicking a stop handle
      if (e.target !== barRef.current) return;
      const pos = getPosFromEvent(e.clientX);
      const newStop: GradientStop = {
        position: pos,
        color: [255, 255, 255, 255] as Color,
      };
      const newStops = [...stops, newStop].sort((a, b) => a.position - b.position);
      onChange(newStops, rotation);
    },
    [stops, rotation, onChange, getPosFromEvent],
  );

  const handleStopMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDragIndex(index);
  }, []);

  const handleStopDoubleClick = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (stops.length <= 2) return; // keep at least 2 stops
      const newStops = stops.filter((_, i) => i !== index);
      onChange(newStops, rotation);
    },
    [stops, rotation, onChange],
  );

  const handleStopColorChange = useCallback(
    (index: number, color: Color) => {
      const newStops = stops.map((s, i) => (i === index ? { ...s, color } : s));
      onChange(newStops, rotation);
    },
    [stops, rotation, onChange],
  );

  // Global mouse move for dragging
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragIndex === null) return;
      const pos = getPosFromEvent(e.clientX);
      const newStops = stops.map((s, i) => (i === dragIndex ? { ...s, position: pos } : s));
      // Sort by position but keep track of which is the dragged one
      const draggedStop = newStops[dragIndex];
      const sorted = [...newStops].sort((a, b) => a.position - b.position);
      const newDragIndex = sorted.indexOf(draggedStop);
      onChange(sorted, rotation);
      setDragIndex(newDragIndex);
    },
    [dragIndex, stops, rotation, onChange, getPosFromEvent],
  );

  const handleMouseUp = useCallback(() => {
    setDragIndex(null);
  }, []);

  const handleRotationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      onChange(stops, val);
    },
    [stops, onChange],
  );

  return (
    <div
      style={{ padding: 'var(--space-1)' }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Gradient preview bar */}
      <div
        ref={barRef}
        onClick={handleBarClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            // Add a stop at 50% on Enter/Space
            const newStop: GradientStop = {
              position: 0.5,
              color: [255, 255, 255, 255] as Color,
            };
            const newStops = [...stops, newStop].sort((a, b) => a.position - b.position);
            onChange(newStops, rotation);
          }
        }}
        aria-label="Gradient preview, click or press Enter to add stop"
        tabIndex={0}
        style={{
          position: 'relative',
          height: 24,
          borderRadius: 'var(--radius-sm)',
          background: `linear-gradient(to right, ${gradientCss})`,
          border: '1px solid var(--color-border-subtle)',
          cursor: 'copy',
          marginBottom: 'var(--space-2)',
        }}
      >
        {/* Stop handles */}
        {stops.map((stop, i) => {
          const [r, g, b, a] = stop.color;
          const swatchColor = `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
          return (
            <button
              type="button"
              key={i}
              onMouseDown={(e) => handleStopMouseDown(i, e)}
              onDoubleClick={(e) => handleStopDoubleClick(i, e)}
              aria-label={`Stop at ${(stop.position * 100).toFixed(0)} percent`}
              tabIndex={0}
              style={{
                position: 'absolute',
                left: `${stop.position * 100}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: swatchColor,
                border: '2px solid var(--color-surface-overlay)',
                boxShadow: 'var(--shadow-sm)',
                cursor: dragIndex === i ? 'grabbing' : 'grab',
                zIndex: dragIndex === i ? 2 : 1,
              }}
            />
          );
        })}
      </div>

      {/* Rotation control */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          marginBottom: 'var(--space-1)',
        }}
      >
        <label
          htmlFor="gradient-rotation"
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
            flexShrink: 0,
          }}
        >
          Rotation
        </label>
        <input
          id="gradient-rotation"
          type="number"
          value={rotation}
          min={0}
          max={360}
          onChange={handleRotationChange}
          aria-label="Gradient rotation in degrees"
          style={{
            width: 60,
            fontSize: 'var(--font-size-xs)',
            background: 'var(--color-surface-sunken)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '0 var(--space-1)',
          }}
        />
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          deg
        </span>
      </div>

      {/* Stop color inputs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {stops.map((stop, i) => {
          const [r, g, b, a] = stop.color;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              <input
                type="color"
                value={`#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`}
                onChange={(e) => {
                  const hex = e.target.value;
                  const nr = parseInt(hex.slice(1, 3), 16);
                  const ng = parseInt(hex.slice(3, 5), 16);
                  const nb = parseInt(hex.slice(5, 7), 16);
                  handleStopColorChange(i, [nr, ng, nb, a] as Color);
                }}
                aria-label={`Stop ${i + 1} color`}
                style={{
                  width: 24,
                  height: 24,
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              />
              <input
                type="number"
                value={Math.round(stop.position * 100)}
                min={0}
                max={100}
                onChange={(e) => {
                  const pos = Number(e.target.value) / 100;
                  const newStops = stops.map((s, j) =>
                    j === i ? { ...s, position: Math.max(0, Math.min(1, pos)) } : s,
                  );
                  onChange(
                    newStops.sort((a, b) => a.position - b.position),
                    rotation,
                  );
                }}
                aria-label={`Stop ${i + 1} position`}
                style={{
                  width: 50,
                  fontSize: 'var(--font-size-xs)',
                  background: 'var(--color-surface-sunken)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0 var(--space-1)',
                }}
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                %
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
