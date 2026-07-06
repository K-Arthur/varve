/**
 * Collab presence hook — loads stub users and publishes local cursor position.
 */
import { type CollabUser, getCollabUsers, updateCursor } from '@strata/collab';
import { useEffect, useState } from 'react';
import type { PresenceData } from '../components/LayersPanel/PresenceIndicator';

export interface CollabPresenceState {
  users: CollabUser[];
  presences: PresenceData[];
}

export function useCollabPresence(
  documentId: string | undefined,
  cursorPos: { x: number; y: number } | null,
  viewportPan: { x: number; y: number },
): CollabPresenceState {
  const [users, setUsers] = useState<CollabUser[]>([]);

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
    if (!documentId || !cursorPos) return;
    updateCursor(documentId, {
      userId: 'local',
      x: cursorPos.x,
      y: cursorPos.y,
      viewportX: viewportPan.x,
      viewportY: viewportPan.y,
      timestamp: Date.now(),
    }).catch(() => {});
  }, [documentId, cursorPos, viewportPan.x, viewportPan.y]);

  const presences: PresenceData[] = users.map((u) => ({
    userId: u.id,
    label: u.name,
    color: u.color,
  }));

  return { users, presences };
}
