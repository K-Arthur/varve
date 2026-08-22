import { prefersReducedMotion } from '@varve/prototype';
import type { Document, NodeId } from '@varve/scene';
import { Icon } from '@varve/ui';
import { type CSSProperties, useCallback, useEffect, useMemo } from 'react';
import { computeSmartAnimateHotspotOverrides } from '../../motion/smartAnimateBridge';
import { DeviceFrame } from './DeviceFrame';
import { PrototypeScreenView, type PrototypeScreenViewProps } from './PrototypeScreenView';
import {
  type ActivePrototypeTransition,
  computeTransitionVisuals,
  usePrototypeTransition,
} from './usePrototypeTransition';

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
  activeTransition?: ActivePrototypeTransition | null;
  onClearTransition?: () => void;
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
  activeTransition = null,
  onClearTransition,
}: PrototypePresenterProps) {
  const transitionProgress = usePrototypeTransition(activeTransition ?? null);

  useEffect(() => {
    if (activeTransition && transitionProgress >= 1) {
      onClearTransition?.();
    }
  }, [activeTransition, transitionProgress, onClearTransition]);

  const reducedMotion = prefersReducedMotion();
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

  if (!isOpen) return null;

  const smartHotspotOverrides =
    activeTransition &&
    transitionProgress < 1 &&
    !reducedMotion &&
    activeTransition.transition.kind === 'smartAnimate' &&
    activeTransition.layerMatches &&
    activeTransition.smartAnimateValues &&
    prototypeDocument &&
    getNodeBounds
      ? computeSmartAnimateHotspotOverrides(
          prototypeDocument,
          activeTransition.layerMatches,
          activeTransition.smartAnimateValues!,
          transitionProgress,
          activeTransition.transition.easing ?? { kind: 'ease' },
          getNodeBounds,
        )
      : null;

  const renderScreen = (
    screenId: string,
    style?: CSSProperties,
    hotspotOverrides?: PrototypeScreenViewProps['hotspotOverrides'],
  ) => {
    if (!prototypeDocument || !hitTestNode || !getNodeBounds) {
      const name = screens.find((s) => s.id === screenId)?.name ?? 'Unknown';
      return (
        <div className="prototype-presenter__screen" style={style}>
          Screen: {name}
        </div>
      );
    }
    return (
      <div className="prototype-presenter__screen-layer" style={style}>
        <PrototypeScreenView
          document={prototypeDocument}
          screenId={screenId}
          overlayStack={overlayStack}
          hitTestNode={hitTestNode}
          getNodeBounds={getNodeBounds}
          hotspotOverrides={hotspotOverrides}
          onEvent={(ev) => onEvent(ev)}
        />
      </div>
    );
  };

  const transitionVisuals =
    activeTransition && transitionProgress < 1 && !reducedMotion
      ? computeTransitionVisuals(activeTransition, transitionProgress)
      : null;

  const transitionCandidate =
    activeTransition && prototypeDocument
      ? prototypeDocument.nodes[activeTransition.fromScreenId]
      : null;
  const transitionFrame = transitionCandidate?.kind === 'frame' ? transitionCandidate : null;

  const screenContent =
    transitionVisuals && activeTransition ? (
      <div
        className="prototype-presenter__transition-stack"
        style={{
          width: transitionFrame?.w ?? 375,
          height: transitionFrame?.h ?? 812,
        }}
      >
        {renderScreen(
          activeTransition.fromScreenId,
          {
            opacity: transitionVisuals.from.opacity,
            transform: transitionVisuals.from.transform,
          },
          smartHotspotOverrides?.from,
        )}
        {renderScreen(
          activeTransition.toScreenId,
          {
            opacity: transitionVisuals.to.opacity,
            transform: transitionVisuals.to.transform,
          },
          smartHotspotOverrides?.to,
        )}
      </div>
    ) : prototypeDocument && hitTestNode && getNodeBounds && currentScreenId ? (
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

  const contentInner = screenContent;

  const content =
    screens.length === 0 ? (
      <div className="prototype-presenter__empty">
        <p>No screens found. Add frames to your design to preview interactions.</p>
      </div>
    ) : deviceConfig ? (
      <div className="prototype-presenter__device-frame">
        <DeviceFrame device={deviceConfig} scale={1}>
          {contentInner}
        </DeviceFrame>
      </div>
    ) : (
      contentInner
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
          aria-label="Exit prototype preview"
        >
          Exit
        </button>
      </div>
      <div className="prototype-presenter__content">{content}</div>
    </div>
  );
}
