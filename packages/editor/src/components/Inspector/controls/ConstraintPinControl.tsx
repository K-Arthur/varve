/**
 * ConstraintPinControl — Figma-style interactive SVG constraint diagram.
 *
 * Shows a parent frame with a child rectangle. Dashed lines connect the child
 * to the parent edges according to the current constraint mode. Clicking zones
 * on the diagram toggles constraint modes:
 *
 *   Left zone   → horizontal: min (pin left)
 *   Right zone  → horizontal: max (pin right)
 *   Between H   → horizontal: stretch
 *   Top zone    → vertical: min (pin top)
 *   Bottom zone → vertical: max (pin bottom)
 *   Between V   → vertical: stretch
 *   Center      → both axes: center
 *   Scale badge → both axes: scale
 *
 * Keyboard: arrow keys navigate zones, Enter/Space activates, Home/End go to
 * center/scale. Fully accessible with ARIA labels on every interactive element.
 *
 * Research basis: Figma Constraints visual editor.
 */
import { useCallback, useRef, useState } from 'react';

export interface ConstraintPinControlProps {
  horizontal: string;
  vertical: string;
  onChange: (h: string, v: string) => void;
  disabled?: boolean;
}

type Zone = 'left' | 'right' | 'stretch-h' | 'top' | 'bottom' | 'stretch-v' | 'center' | 'scale';

const ZONES: Zone[] = [
  'left',
  'right',
  'stretch-h',
  'top',
  'bottom',
  'stretch-v',
  'center',
  'scale',
];

const ZONE_LABELS: Record<Zone, string> = {
  left: 'Pin left edge',
  right: 'Pin right edge',
  'stretch-h': 'Stretch horizontally',
  top: 'Pin top edge',
  bottom: 'Pin bottom edge',
  'stretch-v': 'Stretch vertically',
  center: 'Center both axes',
  scale: 'Scale proportionally',
};

/** Apply a zone click to the current constraint state. */
function applyZone(zone: Zone, h: string, v: string): { h: string; v: string } {
  switch (zone) {
    case 'left':
      return { h: 'min', v };
    case 'right':
      return { h: 'max', v };
    case 'stretch-h':
      return { h: 'stretch', v };
    case 'top':
      return { h, v: 'min' };
    case 'bottom':
      return { h, v: 'max' };
    case 'stretch-v':
      return { h, v: 'stretch' };
    case 'center':
      return { h: 'center', v: 'center' };
    case 'scale':
      return { h: 'scale', v: 'scale' };
  }
}

export function ConstraintPinControl({
  horizontal,
  vertical,
  onChange,
  disabled,
}: ConstraintPinControlProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const focusIndexRef = useRef(0);
  const containerRef = useRef<HTMLFieldSetElement>(null);

  const handleZoneClick = useCallback(
    (zone: Zone) => {
      if (disabled) return;
      const result = applyZone(zone, horizontal, vertical);
      onChange(result.h, result.v);
    },
    [horizontal, vertical, onChange, disabled],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      let next = focusIndexRef.current;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          next = (focusIndexRef.current + 1) % ZONES.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          next = (focusIndexRef.current - 1 + ZONES.length) % ZONES.length;
          break;
        case 'Home':
          e.preventDefault();
          next = ZONES.indexOf('center');
          break;
        case 'End':
          e.preventDefault();
          next = ZONES.indexOf('scale');
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const zone = ZONES[focusIndexRef.current];
          if (zone) handleZoneClick(zone);
          return;
        }
        default:
          return;
      }
      focusIndexRef.current = next;
      setFocusIndex(next);
      const btn = containerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
      btn?.[next]?.focus();
    },
    [disabled, handleZoneClick],
  );

  const activeH = horizontal;
  const activeV = vertical;

  return (
    <fieldset
      ref={containerRef}
      className="constraint-pin-control"
      aria-label="Visual constraint editor"
      onKeyDown={handleKeyDown}
    >
      <svg
        width="120"
        height="96"
        viewBox="0 0 120 96"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="constraint-pin-control__svg"
        aria-hidden="true"
      >
        {/* Parent frame */}
        <rect
          x="12"
          y="8"
          width="96"
          height="80"
          rx="2"
          className="constraint-pin-control__parent"
        />

        {/* Constraint lines — dashed connections from child to parent edges */}
        {activeH === 'min' && (
          <line x1="12" y1="48" x2="36" y2="48" className="constraint-pin-control__line" />
        )}
        {activeH === 'max' && (
          <line x1="84" y1="48" x2="108" y2="48" className="constraint-pin-control__line" />
        )}
        {activeH === 'stretch' && (
          <>
            <line x1="12" y1="48" x2="36" y2="48" className="constraint-pin-control__line" />
            <line x1="84" y1="48" x2="108" y2="48" className="constraint-pin-control__line" />
          </>
        )}
        {activeH === 'center' && (
          <line x1="12" y1="48" x2="108" y2="48" className="constraint-pin-control__line" />
        )}

        {activeV === 'min' && (
          <line x1="60" y1="8" x2="60" y2="28" className="constraint-pin-control__line" />
        )}
        {activeV === 'max' && (
          <line x1="60" y1="68" x2="60" y2="88" className="constraint-pin-control__line" />
        )}
        {activeV === 'stretch' && (
          <>
            <line x1="60" y1="8" x2="60" y2="28" className="constraint-pin-control__line" />
            <line x1="60" y1="68" x2="60" y2="88" className="constraint-pin-control__line" />
          </>
        )}
        {activeV === 'center' && (
          <line x1="60" y1="8" x2="60" y2="88" className="constraint-pin-control__line" />
        )}

        {/* Child rectangle */}
        <rect
          x="36"
          y="28"
          width="48"
          height="40"
          rx="1"
          className="constraint-pin-control__child"
        />

        {/* Pin indicators — small circles on edges where constraints are active */}
        {(activeH === 'min' || activeH === 'stretch') && (
          <circle cx="36" cy="48" r="3" className="constraint-pin-control__pin" />
        )}
        {(activeH === 'max' || activeH === 'stretch') && (
          <circle cx="84" cy="48" r="3" className="constraint-pin-control__pin" />
        )}
        {(activeV === 'min' || activeV === 'stretch') && (
          <circle cx="60" cy="28" r="3" className="constraint-pin-control__pin" />
        )}
        {(activeV === 'max' || activeV === 'stretch') && (
          <circle cx="60" cy="68" r="3" className="constraint-pin-control__pin" />
        )}

        {/* Center indicator when center constraint active */}
        {activeH === 'center' && activeV === 'center' && (
          <circle cx="60" cy="48" r="3" className="constraint-pin-control__pin" />
        )}
      </svg>

      {/* Interactive zones — invisible buttons overlaid on the SVG for interaction */}
      <div className="constraint-pin-control__zones">
        {ZONES.map((zone, i) => (
          <button
            key={zone}
            type="button"
            className="constraint-pin-control__zone"
            aria-label={ZONE_LABELS[zone]}
            tabIndex={i === focusIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => handleZoneClick(zone)}
            onFocus={() => {
              focusIndexRef.current = i;
              setFocusIndex(i);
            }}
            style={getZoneStyle(zone)}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Compute absolute CSS positioning for each zone within the 120×96 SVG. */
function getZoneStyle(zone: Zone): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    cursor: 'pointer',
  };
  switch (zone) {
    case 'left':
      return { ...base, left: 0, top: 28, width: 36, height: 40 };
    case 'right':
      return { ...base, left: 84, top: 28, width: 36, height: 40 };
    // The central controls share the child rectangle. Give each its own
    // horizontal target band so a real pointer can reach every action.
    case 'stretch-h':
      return { ...base, left: 36, top: 28, width: 48, height: 12 };
    case 'top':
      return { ...base, left: 36, top: 0, width: 48, height: 28 };
    case 'bottom':
      return { ...base, left: 36, top: 68, width: 48, height: 28 };
    case 'stretch-v':
      return { ...base, left: 36, top: 56, width: 48, height: 12 };
    case 'center':
      return { ...base, left: 36, top: 40, width: 48, height: 16 };
    case 'scale':
      return { ...base, right: 0, bottom: 0, width: 28, height: 16 };
  }
}
