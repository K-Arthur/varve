import { useCallback, useId, useRef } from 'react';
import type { Color } from './color-utils';

export interface ColorSliderProps {
  channel: 'hue' | 'alpha';
  value: number;
  baseColor?: Color;
  onChange: (value: number) => void;
}

const HUE_GRADIENT =
  'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)';

function alphaGradient(c: Color): string {
  return `linear-gradient(to right, rgba(${c[0]},${c[1]},${c[2]},0), rgba(${c[0]},${c[1]},${c[2]},1))`;
}

const CHECKERBOARD_ID = 'alpha-checker';

export function ColorSlider({
  channel,
  value,
  baseColor = [0, 0, 0, 255] as Color,
  onChange,
}: ColorSliderProps) {
  const autoId = useId();
  const checkerId = `${CHECKERBOARD_ID}-${autoId}`;
  const trackRef = useRef<HTMLDivElement>(null);

  const min = 0;
  const max = channel === 'hue' ? 360 : 1;

  const displayValue = channel === 'hue' ? Math.round(value) : Math.round(value * 100);
  const valueText = channel === 'hue' ? `${displayValue} degrees` : `${displayValue}% opacity`;
  const pct = channel === 'hue' ? (value / max) * 100 : value * 100;

  const clamp = useCallback((v: number) => Math.max(min, Math.min(max, v)), [max]);

  const valueFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return value;
      const rect = track.getBoundingClientRect();
      const pct = (clientX - rect.left) / rect.width;
      return clamp(pct * (max - min) + min);
    },
    [max, value, clamp],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      onChange(valueFromPointer(e.clientX));
    },
    [onChange, valueFromPointer],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.buttons !== 1) return;
      e.preventDefault();
      onChange(valueFromPointer(e.clientX));
    },
    [onChange, valueFromPointer],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const coarse = channel === 'hue' ? 10 : 0.1;
      const fine = channel === 'hue' ? 1 : 0.01;
      const step = e.shiftKey ? coarse : fine;
      let newValue = value;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          newValue = clamp(value + step);
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          newValue = clamp(value - step);
          break;
        case 'PageUp':
          newValue = clamp(value + coarse);
          break;
        case 'PageDown':
          newValue = clamp(value - coarse);
          break;
        case 'Home':
          newValue = min;
          break;
        case 'End':
          newValue = max;
          break;
        default:
          return;
      }
      e.preventDefault();
      onChange(newValue);
    },
    [channel, value, clamp, max, onChange],
  );

  return (
    <div className={`insp-slider color-slider--${channel}`}>
      <div
        ref={trackRef}
        className="insp-slider__track"
        style={{
          overflow: 'hidden',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        {channel === 'alpha' && (
          <svg aria-hidden="true" className="color-slider__checkerboard">
            <defs>
              <pattern id={checkerId} width="8" height="8" patternUnits="userSpaceOnUse">
                <rect width="4" height="4" fill="var(--color-surface-sunken)" />
                <rect x="4" y="4" width="4" height="4" fill="var(--color-surface-sunken)" />
                <rect x="4" width="4" height="4" fill="var(--color-surface-overlay)" />
                <rect y="4" width="4" height="4" fill="var(--color-surface-overlay)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${checkerId})`} />
          </svg>
        )}
        <div
          className="color-slider__gradient"
          style={{ background: channel === 'hue' ? HUE_GRADIENT : alphaGradient(baseColor) }}
        />
        <div
          className="insp-slider__fill"
          style={{
            width: `${pct}%`,
            // The hue spectrum is the track's indicator; alpha retains the
            // standard fill so its current opacity remains obvious.
            background: channel === 'hue' ? 'transparent' : 'var(--color-interactive-default)',
          }}
        />
        <div
          className="insp-slider__thumb"
          style={{ left: `${pct}%` }}
          role="slider"
          tabIndex={0}
          aria-valuenow={channel === 'alpha' ? Math.round(value * 100) : Math.round(value)}
          aria-valuemin={min}
          aria-valuemax={channel === 'alpha' ? 100 : max}
          aria-valuetext={valueText}
          aria-label={channel === 'hue' ? 'Hue' : 'Alpha'}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
