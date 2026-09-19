/**
 * EffectLightPad — an interactive 2D Light Direction & Distance controller.
 * Lets designers steer shadow and glow light angles visually rather than
 * guessing trigonometry or raw cartesian offsets.
 */
import { useCallback, useRef } from 'react';

interface EffectLightPadProps {
  angle: number;
  distance: number;
  onChange: (coords: { x: number; y: number; angle: number; distance: number }) => void;
  disabled?: boolean;
}

const PAD_RADIUS = 32; // px radius of pad surface
const MAX_DISPLAY_DISTANCE = 40; // distance that reaches outer edge

export function EffectLightPad({
  angle,
  distance,
  onChange,
  disabled = false,
}: EffectLightPadProps) {
  const padRef = useRef<HTMLDivElement>(null);

  // Position of handle inside 72x72 box (center is at 36, 36)
  const normDist = Math.min(1, distance / MAX_DISPLAY_DISTANCE);
  const rad = (angle * Math.PI) / 180;
  const handleX = 36 + Math.cos(rad) * normDist * PAD_RADIUS;
  const handleY = 36 + Math.sin(rad) * normDist * PAD_RADIUS;

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      if (disabled || !padRef.current) return;
      const rect = padRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const rawDistance = Math.hypot(dx, dy);

      if (rawDistance < 3) {
        // Near center: snap to 0 distance
        onChange({ x: 0, y: 0, angle: 0, distance: 0 });
        return;
      }

      const calculatedAngle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
      const normalizedAngle = calculatedAngle < 0 ? calculatedAngle + 360 : calculatedAngle;

      // Scale distance: radius 32px maps to ~32px offset
      const scaledDistance = Math.round(rawDistance);
      const angleRad = (normalizedAngle * Math.PI) / 180;
      const newX = Math.round(Math.cos(angleRad) * scaledDistance);
      const newY = Math.round(Math.sin(angleRad) * scaledDistance);

      onChange({
        x: newX,
        y: newY,
        angle: normalizedAngle,
        distance: scaledDistance,
      });
    },
    [disabled, onChange],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    updateFromPointer(e.clientX, e.clientY);
  };

  const setPresetDirection = (presetAngle: number) => {
    if (disabled) return;
    const currentDist = distance > 0 ? distance : 8;
    const angleRad = (presetAngle * Math.PI) / 180;
    const newX = Math.round(Math.cos(angleRad) * currentDist);
    const newY = Math.round(Math.sin(angleRad) * currentDist);
    onChange({
      x: newX,
      y: newY,
      angle: presetAngle,
      distance: currentDist,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let newAngle = angle;
    let newDist = distance > 0 ? distance : 4;

    switch (e.key) {
      case 'ArrowUp':
        newAngle = 270;
        break;
      case 'ArrowDown':
        newAngle = 90;
        break;
      case 'ArrowLeft':
        newAngle = 180;
        break;
      case 'ArrowRight':
        newAngle = 0;
        break;
      case '+':
      case '=':
        newDist = Math.min(100, distance + 1);
        break;
      case '-':
        newDist = Math.max(0, distance - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    const angleRad = (newAngle * Math.PI) / 180;
    onChange({
      x: Math.round(Math.cos(angleRad) * newDist),
      y: Math.round(Math.sin(angleRad) * newDist),
      angle: newAngle,
      distance: newDist,
    });
  };

  const isAngleNear = (target: number) => {
    const diff = Math.abs(((angle - target + 180) % 360) - 180);
    return diff < 15 && distance > 0;
  };

  return (
    <div className="insp-light-pad-wrapper">
      <div
        ref={padRef}
        className="insp-light-pad"
        role="slider"
        aria-label="Light direction angle"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={angle}
        aria-valuetext={`${angle} degrees, ${distance}px distance`}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onKeyDown={handleKeyDown}
      >
        <svg className="insp-light-pad__dial" viewBox="0 0 72 72" aria-hidden="true">
          {/* Compass grid lines */}
          <line
            x1="36"
            y1="8"
            x2="36"
            y2="64"
            stroke="var(--color-border-subtle)"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
          <line
            x1="8"
            y1="36"
            x2="64"
            y2="36"
            stroke="var(--color-border-subtle)"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
          {/* Direction indicator line */}
          {distance > 0 && (
            <line
              x1="36"
              y1="36"
              x2={handleX}
              y2={handleY}
              stroke="var(--color-interactive-default)"
              strokeWidth="1.5"
            />
          )}
        </svg>
        <div className="insp-light-pad__center-mark" />
        <div
          className="insp-light-pad__handle"
          style={{
            left: `${handleX}px`,
            top: `${handleY}px`,
          }}
        />
      </div>

      <div className="insp-light-pad__details">
        <div className="insp-light-pad__snap-row">
          <button
            type="button"
            className={`insp-light-pad__snap-btn${isAngleNear(90) ? ' insp-light-pad__snap-btn--active' : ''}`}
            onClick={() => setPresetDirection(90)}
            title="Down (90°)"
            aria-label="Light down 90 degrees"
          >
            Down
          </button>
          <button
            type="button"
            className={`insp-light-pad__snap-btn${isAngleNear(45) ? ' insp-light-pad__snap-btn--active' : ''}`}
            onClick={() => setPresetDirection(45)}
            title="Bottom-Right (45°)"
            aria-label="Light bottom-right 45 degrees"
          >
            45°
          </button>
          <button
            type="button"
            className={`insp-light-pad__snap-btn${isAngleNear(135) ? ' insp-light-pad__snap-btn--active' : ''}`}
            onClick={() => setPresetDirection(135)}
            title="Bottom-Left (135°)"
            aria-label="Light bottom-left 135 degrees"
          >
            135°
          </button>
          <button
            type="button"
            className={`insp-light-pad__snap-btn${distance === 0 ? ' insp-light-pad__snap-btn--active' : ''}`}
            onClick={() => onChange({ x: 0, y: 0, angle: 0, distance: 0 })}
            title="Center (0 offset)"
            aria-label="Center 0 offset"
          >
            0
          </button>
        </div>
      </div>
    </div>
  );
}
