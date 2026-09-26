/**
 * Collab presence hook — loads stub users and publishes local cursor position.
 */
import { type CollabUser, getCollabUsers, updateCursor } from '@varve/collab';
import { useEffect, useRef, useState } from 'react';
import { getCursorWorldPosition, subscribeCursorWorldPosition } from '../canvas/cursorPosition';
import type { PresenceData } from '../components/LayersPanel/PresenceIndicator';

export interface CollabPresenceState {
  users: CollabUser[];
  presences: PresenceData[];
}

function publishLocalCursor(
  documentId: string,
  position: { x: number; y: number },
  viewportPan: { x: number; y: number },
): void {
  updateCursor(documentId, {
    userId: 'local',
    x: position.x,
    y: position.y,
    viewportX: viewportPan.x,
    viewportY: viewportPan.y,
    timestamp: Date.now(),
  }).catch(() => {});
}

/**
 * `cursorPos` is an explicit override kept for call-site compatibility. The
 * live pointer is read from the canvas cursor store inside an effect, so the
 * calling component (the editor shell) does not re-render per pointer frame.
 */
export function useCollabPresence(
  documentId: string | undefined,
  cursorPos: { x: number; y: number } | null,
  viewportPan: { x: number; y: number },
): CollabPresenceState {
  const [users, setUsers] = useState<CollabUser[]>([]);
  const panRef = useRef(viewportPan);
  panRef.current = viewportPan;

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    getCollabUsers(documentId).then((list) => {
      if (!cancelled) setUsers(list);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    if (!documentId) return;
    const position = cursorPos ?? getCursorWorldPosition();
    if (position) {
      publishLocalCursor(documentId, position, { x: viewportPan.x, y: viewportPan.y });
    }
  }, [documentId, cursorPos, viewportPan.x, viewportPan.y]);

  useEffect(() => {
    if (!documentId || cursorPos) return;
    return subscribeCursorWorldPosition(() => {
      const position = getCursorWorldPosition();
      if (position) publishLocalCursor(documentId, position, panRef.current);
    });
  }, [documentId, cursorPos]);

  const presences: PresenceData[] = users.map((u) => ({
    userId: u.id,
    label: u.name,
    color: u.color,
  }));

  return { users, presences };
}
