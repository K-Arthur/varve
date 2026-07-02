import { useMemo } from 'react';
import { DeviceFrame } from './DeviceFrame';

interface PrototypePlayerProps {
  currentScreenId: string;
  screens: Array<{ id: string; name: string }>;
  onEvent: (event: unknown) => void;
  onNavigate: (screenId: string) => void;
  deviceConfig?: {
    type: string;
    name: string;
    width: number;
    height: number;
    dpr: number;
    showNotch?: boolean;
    showHomeIndicator?: boolean;
  };
  reducedMotion?: boolean;
  showHints?: boolean;
}

export function PrototypePlayer({
  currentScreenId,
  screens,
  onEvent,
  deviceConfig,
  reducedMotion,
  showHints,
}: PrototypePlayerProps) {
  const currentIndex = useMemo(
    () => screens.findIndex((s) => s.id === currentScreenId),
    [screens, currentScreenId],
  );
  const currentScreen = useMemo(
    () => screens.find((s) => s.id === currentScreenId),
    [screens, currentScreenId],
  );

  const rootClass = ['prototype-player', reducedMotion ? 'prototype-player--reduced-motion' : '']
    .filter(Boolean)
    .join(' ');

  const content = (
    <div
      className="prototype-player__interaction-area"
      onClick={() => onEvent({ type: 'click', screenId: currentScreenId })}
    >
      {screens.length === 0 ? (
        <div className="prototype-player__empty">
          <p>No screens found.</p>
        </div>
      ) : (
        <div className="prototype-player__screen">
          <span className="prototype-player__screen-name">{currentScreen?.name ?? 'Unknown'}</span>
          <span className="prototype-player__counter">
            {currentIndex + 1} / {screens.length}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className={rootClass}>
      {showHints && screens.length > 0 && (
        <div className="prototype-player__hints-overlay" aria-label="Interactive areas">
          <span>Click anywhere to interact</span>
        </div>
      )}
      {deviceConfig && screens.length > 0 ? (
        <DeviceFrame device={deviceConfig}>{content}</DeviceFrame>
      ) : (
        content
      )}
    </div>
  );
}
