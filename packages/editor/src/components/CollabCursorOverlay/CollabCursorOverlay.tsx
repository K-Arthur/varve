/**
 * Ephemeral collaborator cursor labels on the canvas (stub transport).
 */

import type { CollabUser } from '@varve/collab';
import type { CSSProperties } from 'react';
import './CollabCursorOverlay.css';

export interface RemoteCursor {
  userId: string;
  x: number;
  y: number;
}

export function CollabCursorOverlay({
  users,
  cursors,
  worldToScreen,
}: {
  users: CollabUser[];
  cursors: RemoteCursor[];
  worldToScreen: (wx: number, wy: number) => { x: number; y: number };
}) {
  if (cursors.length === 0) return null;

  return (
    <div className="collab-cursor-overlay" aria-hidden>
      {cursors.map((c) => {
        const user = users.find((u) => u.id === c.userId);
        if (!user) return null;
        const { x, y } = worldToScreen(c.x, c.y);
        return (
          <div
            key={c.userId}
            className="collab-cursor-overlay__cursor"
            style={{ left: x, top: y, '--cursor-color': user.color } as CSSProperties}
          >
            <span className="collab-cursor-overlay__label">{user.name}</span>
          </div>
        );
      })}
    </div>
  );
}
