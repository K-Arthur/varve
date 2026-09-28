import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceMode } from '../workspaceTypes';
import type { DockFloatingGroup } from './dockTypes';

type GestureKind = 'move' | 'resize';

interface ActiveGesture {
  pointerId: number;
  mode: WorkspaceMode;
  groupId: string;
  kind: GestureKind;
  startX: number;
  startY: number;
  width: number;
  height: number;
  bounds: DockFloatingGroup['normalizedBounds'];
  minimumWidth: number;
  minimumHeight: number;
}

export interface FloatGestureHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
  onBlur: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

/** Transient drag/resize preview; one validated preference write occurs on commit. */
export function useFloatingGroupInteractions(
  mode: WorkspaceMode,
  host: { width: number; height: number } | null,
  commit: (
    mode: WorkspaceMode,
    groupId: string,
    bounds: DockFloatingGroup['normalizedBounds'],
  ) => void,
) {
  const active = useRef<ActiveGesture | null>(null);
  const [preview, setPreview] = useState<{
    mode: WorkspaceMode;
    groupId: string;
    bounds: DockFloatingGroup['normalizedBounds'];
  } | null>(null);

  const boundsFor = useCallback(
    (groupId: string, saved: DockFloatingGroup['normalizedBounds']) =>
      preview?.mode === mode && preview.groupId === groupId ? preview.bounds : saved,
    [mode, preview],
  );

  const cancel = useCallback(() => {
    active.current = null;
    setPreview(null);
  }, []);

  useEffect(() => cancel, [cancel, mode]);

  const gestureHandlers = useCallback(
    (
      groupId: string,
      savedBounds: DockFloatingGroup['normalizedBounds'],
      minimumSize: { width: number; height: number },
      kind: GestureKind,
    ): FloatGestureHandlers => {
      const calculate = (gesture: ActiveGesture, clientX: number, clientY: number) => {
        const dx = (clientX - gesture.startX) / Math.max(1, gesture.width);
        const dy = (clientY - gesture.startY) / Math.max(1, gesture.height);
        if (gesture.kind === 'move') {
          return {
            ...gesture.bounds,
            x: clamp(gesture.bounds.x + dx, 0, 1 - gesture.bounds.width),
            y: clamp(gesture.bounds.y + dy, 0, 1 - gesture.bounds.height),
          };
        }
        return {
          ...gesture.bounds,
          width: clamp(
            gesture.bounds.width + dx,
            Math.min(1, gesture.minimumWidth / Math.max(1, gesture.width)),
            1 - gesture.bounds.x,
          ),
          height: clamp(
            gesture.bounds.height + dy,
            Math.min(1, gesture.minimumHeight / Math.max(1, gesture.height)),
            1 - gesture.bounds.y,
          ),
        };
      };
      const begin = (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0 || !host || host.width <= 0 || host.height <= 0) return;
        const button = (event.target as HTMLElement).closest('button');
        if (
          (button && button.dataset.dockResizeHandle !== 'true') ||
          (event.target as HTMLElement).closest('[data-no-drag="true"]')
        )
          return;
        event.preventDefault();
        active.current = {
          pointerId: event.pointerId,
          mode,
          groupId,
          kind,
          startX: event.clientX,
          startY: event.clientY,
          width: host.width,
          height: host.height,
          bounds: { ...savedBounds },
          minimumWidth: minimumSize.width,
          minimumHeight: minimumSize.height,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      };
      const move = (event: ReactPointerEvent<HTMLElement>) => {
        const gesture = active.current;
        if (!gesture || gesture.pointerId !== event.pointerId || gesture.groupId !== groupId)
          return;
        setPreview({
          mode: gesture.mode,
          groupId,
          bounds: calculate(gesture, event.clientX, event.clientY),
        });
      };
      const finish = (event: ReactPointerEvent<HTMLElement>) => {
        const gesture = active.current;
        if (!gesture || gesture.pointerId !== event.pointerId || gesture.groupId !== groupId)
          return;
        const nextBounds = calculate(gesture, event.clientX, event.clientY);
        active.current = null;
        setPreview(null);
        if (JSON.stringify(gesture.bounds) !== JSON.stringify(nextBounds)) {
          commit(gesture.mode, groupId, nextBounds);
        }
      };
      const keyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key === 'Escape' && active.current?.groupId === groupId) {
          event.preventDefault();
          cancel();
          return;
        }
        if (event.target !== event.currentTarget) return;
        if (!host || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
          return;
        event.preventDefault();
        const delta = event.shiftKey ? 0.08 : 0.02;
        const next = { ...savedBounds };
        if (kind === 'move') {
          if (event.key === 'ArrowLeft') next.x = clamp(next.x - delta, 0, 1 - next.width);
          if (event.key === 'ArrowRight') next.x = clamp(next.x + delta, 0, 1 - next.width);
          if (event.key === 'ArrowUp') next.y = clamp(next.y - delta, 0, 1 - next.height);
          if (event.key === 'ArrowDown') next.y = clamp(next.y + delta, 0, 1 - next.height);
        } else {
          if (event.key === 'ArrowLeft')
            next.width = clamp(next.width - delta, minimumSize.width / host.width, 1 - next.x);
          if (event.key === 'ArrowRight')
            next.width = clamp(next.width + delta, minimumSize.width / host.width, 1 - next.x);
          if (event.key === 'ArrowUp')
            next.height = clamp(next.height - delta, minimumSize.height / host.height, 1 - next.y);
          if (event.key === 'ArrowDown')
            next.height = clamp(next.height + delta, minimumSize.height / host.height, 1 - next.y);
        }
        commit(mode, groupId, next);
      };
      return {
        onPointerDown: begin,
        onPointerMove: move,
        onPointerUp: finish,
        onPointerCancel: cancel,
        onLostPointerCapture: cancel,
        onBlur: cancel,
        onKeyDown: keyDown,
      };
    },
    [cancel, commit, host, mode],
  );

  return { boundsFor, cancel, gestureHandlers };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
