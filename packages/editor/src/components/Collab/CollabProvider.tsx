import { getCollabUsers, updateCursor, type CollabUser, type LiveCursor } from '@strata/collab';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface StubCursor extends LiveCursor {
  name: string;
  color: string;
}

interface CollabContextValue {
  users: CollabUser[];
  cursors: StubCursor[];
  setCursor: (cursor: Omit<StubCursor, 'name' | 'color' | 'timestamp'>) => void;
}

const CollabContext = createContext<CollabContextValue | null>(null);

const STUB_CURSORS: StubCursor[] = [
  { userId: 'user-1', name: 'Alice', color: '#39d0c6', x: 200, y: 150, viewportX: 0, viewportY: 0, timestamp: Date.now() },
  { userId: 'user-2', name: 'Bob', color: '#e06c75', x: 350, y: 280, viewportX: 0, viewportY: 0, timestamp: Date.now() },
  { userId: 'user-3', name: 'Charlie', color: '#61afef', x: 100, y: 400, viewportX: 0, viewportY: 0, timestamp: Date.now() },
];

export function CollabProvider({ documentId, children }: { documentId: string; children: ReactNode }) {
  const [users, setUsers] = useState<CollabUser[]>([]);
  const [cursors, setCursors] = useState<StubCursor[]>(STUB_CURSORS);

  useEffect(() => {
    getCollabUsers(documentId).then(setUsers);
  }, [documentId]);

  const setCursor = (pos: Omit<StubCursor, 'name' | 'color' | 'timestamp'>) => {
    const now = Date.now();
    setCursors((prev) =>
      prev.map((c) =>
        c.userId === pos.userId
          ? { ...c, ...pos, timestamp: now }
          : c,
      ),
    );
    updateCursor(documentId, { ...pos, timestamp: now });
  };

  return (
    <CollabContext.Provider value={{ users, cursors, setCursor }}>
      {children}
    </CollabContext.Provider>
  );
}

export function useCollab(): CollabContextValue {
  const ctx = useContext(CollabContext);
  if (!ctx) throw new Error('useCollab must be used within CollabProvider');
  return ctx;
}
