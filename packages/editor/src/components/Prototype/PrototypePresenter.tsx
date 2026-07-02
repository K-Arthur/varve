import React, { useCallback, useEffect, useMemo } from 'react';
import { DeviceFrame } from './DeviceFrame';

interface PrototypePresenterProps {
  isOpen: boolean;
  onClose: () => void;
  screens: Array<{ id: string; name: string }>;
  currentScreenId: string;
  onNavigate: (screenId: string) => void;
  onEvent: (event: unknown) => void;
  deviceConfig?: {
    type: string;
    name: string;
    width: number;
    height: number;
    dpr: number;
    showNotch?: boolean;
    showHomeIndicator?: boolean;
  };
  debugConsole?: unknown;
  onScreenshot?: () => void;
}

export function PrototypePresenter({
  isOpen,
  onClose,
  screens,
  currentScreenId,
  onNavigate,
  onEvent,
  deviceConfig,
}: PrototypePresenterProps) {
  const currentIndex = useMemo(
    () => screens.findIndex((s) => s.id === currentScreenId),
    [screens, currentScreenId],
  );
  const currentScreen = useMemo(
    () => screens.find((s) => s.id === currentScreenId),
    [screens, currentScreenId],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' && currentIndex < screens.length - 1) {
        onNavigate(screens[currentIndex + 1].id);
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        onNavigate(screens[currentIndex - 1].id);
      }
    },
    [onClose, onNavigate, currentIndex, screens],
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  useEffect(() => {
    if (isOpen) {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      }
    } else {
      if (document.exitFullscreen && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const content = (
    <div
      className="prototype-presenter__content"
      onClick={() => onEvent({ type: 'click', screenId: currentScreenId })}
    >
      {screens.length === 0 ? (
        <div className="prototype-presenter__empty">
          <p>No screens found. Add frames to your design to preview interactions.</p>
        </div>
      ) : deviceConfig ? (
        <div className="prototype-presenter__device-frame">
          <DeviceFrame
            device={deviceConfig}
            scale={1}
          >
            <div className="prototype-presenter__screen">
              Screen: {currentScreen?.name ?? 'Unknown'}
            </div>
          </DeviceFrame>
        </div>
      ) : (
        <div className="prototype-presenter__screen">
          Screen: {currentScreen?.name ?? 'Unknown'}
        </div>
      )}
    </div>
  );

  return (
    <div className="prototype-presenter" role="dialog" aria-modal="true" aria-label="Prototype Preview">
      <div className="prototype-presenter__toolbar">
        <span className="prototype-presenter__screen-name">
          {currentScreen?.name ?? 'No screen'}
        </span>
        <span className="prototype-presenter__counter">
          {currentIndex + 1} / {screens.length}
        </span>
        <button
          className="prototype-presenter__nav-btn"
          disabled={currentIndex <= 0}
          onClick={() => currentIndex > 0 && onNavigate(screens[currentIndex - 1].id)}
          aria-label="Previous screen"
        >
          ←
        </button>
        <button
          className="prototype-presenter__nav-btn"
          disabled={currentIndex >= screens.length - 1}
          onClick={() =>
            currentIndex < screens.length - 1 && onNavigate(screens[currentIndex + 1].id)
          }
          aria-label="Next screen"
        >
          →
        </button>
        <button className="prototype-presenter__exit-btn" onClick={onClose} aria-label="Exit fullscreen">
          Exit
        </button>
      </div>
      {content}
    </div>
  );
}
