import { Icon } from '@strata/ui';
import type { Document, NodeId } from '@strata/scene';
import { useCallback, useEffect, useMemo } from 'react';
import { DeviceFrame } from './DeviceFrame';
import { PrototypeScreenView } from './PrototypeScreenView';

interface PrototypePresenterProps {
  isOpen: boolean;
  onClose: () => void;
  screens: Array<{ id: string; name: string }>;
  currentScreenId: string;
  onNavigate: (screenId: string) => void;
  onEvent: (event: unknown) => void;
  /** Document for screen rendering (optional — falls back to placeholder). */
  prototypeDocument?: Document;
  overlayStack?: string[];
  hitTestNode?: (world: { x: number; y: number }) => { nodeId: NodeId } | null;
  getNodeBounds?: (nodeId: NodeId) => { x: number; y: number; w: number; h: number } | null;
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
  prototypeDocument,
  overlayStack = [],
  hitTestNode,
  getNodeBounds,
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
        const next = screens[currentIndex + 1];
        if (next) onNavigate(next.id);
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        const prev = screens[currentIndex - 1];
        if (prev) onNavigate(prev.id);
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

  const screenContent =
    prototypeDocument && hitTestNode && getNodeBounds && currentScreenId ? (
      <PrototypeScreenView
        document={prototypeDocument}
        screenId={currentScreenId}
        overlayStack={overlayStack}
        hitTestNode={hitTestNode}
        getNodeBounds={getNodeBounds}
        onEvent={(ev) => onEvent(ev)}
      />
    ) : (
      <div className="prototype-presenter__screen">Screen: {currentScreen?.name ?? 'Unknown'}</div>
    );

  const content =
    screens.length === 0 ? (
      <div className="prototype-presenter__empty">
        <p>No screens found. Add frames to your design to preview interactions.</p>
      </div>
    ) : deviceConfig ? (
      <div className="prototype-presenter__device-frame">
        <DeviceFrame device={deviceConfig} scale={1}>
          {screenContent}
        </DeviceFrame>
      </div>
    ) : (
      screenContent
    );

  return (
    <div
      className="prototype-presenter"
      role="dialog"
      aria-modal="true"
      aria-label="Prototype Preview"
    >
      <div className="prototype-presenter__toolbar">
        <span className="prototype-presenter__screen-name">
          {currentScreen?.name ?? 'No screen'}
        </span>
        <span className="prototype-presenter__counter">
          {currentIndex + 1} / {screens.length}
        </span>
        <button
          type="button"
          className="prototype-presenter__nav-btn"
          disabled={currentIndex <= 0}
          onClick={() => {
            const prev = screens[currentIndex - 1];
            if (prev) onNavigate(prev.id);
          }}
          aria-label="Previous screen"
        >
          <Icon name="ChevronLeft" size={24} />
        </button>
        <button
          type="button"
          className="prototype-presenter__nav-btn"
          disabled={currentIndex >= screens.length - 1}
          onClick={() => {
            const next = screens[currentIndex + 1];
            if (next) onNavigate(next.id);
          }}
          aria-label="Next screen"
        >
          <Icon name="ChevronRight" size={24} />
        </button>
        <button
          type="button"
          className="prototype-presenter__exit-btn"
          onClick={onClose}
          aria-label="Exit fullscreen"
        >
          Exit
        </button>
      </div>
      {content}
    </div>
  );
}
