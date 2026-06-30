import { useCallback, useId, useRef } from 'react';

export interface ColorAreaProps {
  hue: number;
  saturation: number;
  value: number;
  onChange: (saturation: number, value: number) => void;
  label?: string;
}

export function ColorArea({ hue, saturation, value, onChange, label = 'Color' }: ColorAreaProps) {
  const autoId = useId();
  const satId = `colorarea-sat-${autoId}`;
  const valId = `colorarea-val-${autoId}`;
  const areaRef = useRef<HTMLDivElement>(null);

  const clamp = useCallback((v: number) => Math.max(0, Math.min(100, v)), []);

  const updateFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = areaRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      onChange(clamp(x * 100), clamp(100 - y * 100));
    },
    [onChange, clamp],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      updateFromPoint(e.clientX, e.clientY);
    },
    [updateFromPoint],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.buttons !== 1) return;
      e.preventDefault();
      updateFromPoint(e.clientX, e.clientY);
    },
    [updateFromPoint],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 1;
      let newSat = saturation;
      let newVal = value;
      switch (e.key) {
        case 'ArrowLeft':
          newSat = clamp(saturation - step);
          break;
        case 'ArrowRight':
          newSat = clamp(saturation + step);
          break;
        case 'ArrowUp':
          newVal = clamp(value + step);
          break;
        case 'ArrowDown':
          newVal = clamp(value - step);
          break;
        default:
          return;
      }
      e.preventDefault();
      onChange(newSat, newVal);
    },
    [saturation, value, onChange, clamp],
  );

  return (
    <div
      ref={areaRef}
      role="slider"
      aria-roledescription="2D Slider"
      aria-label={label}
      aria-valuenow={Math.round((saturation + value) / 2)}
      aria-valuetext={`Saturation ${Math.round(saturation)}%, Value ${Math.round(value)}%`}
      tabIndex={0}
      style={{
        position: 'relative',
        width: '100%',
        paddingBottom: '75%',
        background: `hsl(${hue}, 100%, 50%)`,
        borderRadius: 'var(--radius-sm)',
        cursor: 'crosshair',
        overflow: 'hidden',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(to right, white, transparent), linear-gradient(to top, black, transparent)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: `${saturation}%`,
          top: `${100 - value}%`,
          width: 16,
          height: 16,
          marginLeft: -8,
          marginTop: -8,
          borderRadius: '50%',
          background: 'white',
          border: '2px solid rgba(0,0,0,0.6)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.3)',
          pointerEvents: 'none',
          transform: 'translateZ(0)',
        }}
      />
      <input
        id={satId}
        type="range"
        className="sr-only"
        tabIndex={-1}
        aria-roledescription="2D Slider"
        aria-valuetext={`Saturation ${Math.round(saturation)}%, Value ${Math.round(value)}%`}
        value={saturation}
        min={0}
        max={100}
        readOnly
      />
      <input
        id={valId}
        type="range"
        className="sr-only"
        tabIndex={-1}
        aria-roledescription="2D Slider"
        aria-valuetext={`Saturation ${Math.round(saturation)}%, Value ${Math.round(value)}%`}
        value={value}
        min={0}
        max={100}
        readOnly
      />
    </div>
  );
}
