# EditorProvider Context Extraction Plan

> **For agentic workers:** Subagent-driven implementation.

**Goal:** Reduce EditorProvider cyclomatic complexity (967) by extracting self-contained subsystems into focused hooks.

**Architecture:** Each hook encapsulates its own state/refs and returns a memoized API object. The EditorProvider uses these hooks and spreads their return values into the giant `useMemo<EditorContextValue>`.

**Current state:** ViewportContext, SelectionContext, DocumentContext, MotionContext, PrototypeContext already extracted. Remaining: 6163-line context.tsx with EditorProvider at 967 complexity.

---

### Task 1: Extract Save/Load/Persistence hook

**Files:**
- Create: `packages/editor/src/context/usePersistence.ts`
- Modify: `packages/editor/src/context.tsx` (EditorProvider — wire in the hook)

- [ ] **Step 1: Create the persistence hook**

Create `packages/editor/src/context/usePersistence.ts` with:
```ts
import { useCallback, useRef } from 'react';
import type { Document, NodeId } from '@varve/scene';
import { DocumentCodec, createDocument, migrateDocument } from '@varve/scene';
import type { Platform } from '@varve/platform';
import type { EditorState } from './types';
import { loadSettings, updateSettings } from '../settings';
import { AutoSaveService } from '../autoSaveService';
import { RecoveryManager } from '../recovery';

export interface PersistenceAPI {
  newDocument: () => void;
  serializeDocument: () => string;
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  loadDocument: (json: string, meta?: { name?: string; filePath?: string }) => void;
  openFile: (fileId: string, name: string, filePath: string | undefined, json: string | null) => void;
}

export function usePersistence(
  state: EditorState,
  setState: React.Dispatch<React.SetStateAction<EditorState>>,
  patch: (partial: Partial<EditorState>) => void,
  stateRef: React.MutableRefObject<EditorState>,
  platform: Platform | undefined,
  autoSaveRef: React.MutableRefObject<AutoSaveService | null>,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
): PersistenceAPI {
  const newDocument = useCallback(() => {
    setState((s) => {
      const newId = crypto.randomUUID();
      return {
        ...s,
        document: createDocument(),
        selection: [],
        sessions: [...s.sessions, { id: newId, name: 'Untitled', dirty: false }],
        activeId: newId,
        zoom: 1,
        pan: { x: 0, y: 0 },
        dirty: false,
        lastSavedAt: null,
      };
    });
  }, [setState]);

  const serializeDocument = useCallback(() => {
    return DocumentCodec.encode(stateRef.current.document);
  }, [stateRef]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!platform) return false;
    const s = stateRef.current;
    const meta = s.sessions.find((sess) => sess.id === s.activeId);
    if (!meta?.fileId) return saveAsImpl(platform, stateRef, recoveryRef, patch);
    patch({ saveState: 'saving' });
    try {
      const json = DocumentCodec.encode(s.document);
      await platform.upsertFile(meta.fileId, { name: meta.name, content: json });
      await recoveryRef.current?.deleteSession(s.activeId);
      patch({
        dirty: false,
        saveState: 'saved',
        lastSavedAt: Date.now(),
        sessions: s.sessions.map((sess) =>
          sess.id === s.activeId ? { ...sess, dirty: false } : sess,
        ),
      });
      return true;
    } catch {
      patch({ saveState: 'error' });
      return false;
    }
  }, [platform, stateRef, recoveryRef, patch]);

  const saveAs = useCallback(async (): Promise<boolean> => {
    return saveAsImpl(platform, stateRef, recoveryRef, patch);
  }, [platform, stateRef, recoveryRef, patch]);

  const loadDocument = useCallback(
    (json: string, meta?: { name?: string; filePath?: string }) => {
      patch({ saveState: 'loading' });
      try {
        const decoded = DocumentCodec.decode(json);
        if (!decoded.ok) {
          patch({ saveState: 'error' });
          return;
        }
        let doc = decoded.document;
        doc = migrateDocument(doc);
        const newId = crypto.randomUUID();
        setState((s) => ({
          ...s,
          document: doc,
          selection: [],
          sessions: [
            ...s.sessions,
            {
              id: newId,
              name: meta?.name ?? doc.name ?? 'Untitled',
              dirty: false,
              filePath: meta?.filePath,
            },
          ],
          activeId: newId,
          zoom: 1,
          pan: { x: 0, y: 0 },
          dirty: false,
          saveState: 'idle',
          lastSavedAt: null,
        }));
      } catch {
        patch({ saveState: 'error' });
      }
    },
    [patch, setState],
  );

  const openFile = useCallback(
    (fileId: string, name: string, filePath: string | undefined, json: string | null) => {
      if (json) {
        loadDocument(json, { name, filePath });
        return;
      }
      const newId = crypto.randomUUID();
      setState((s) => ({
        ...s,
        sessions: [...s.sessions, { id: newId, name, dirty: false, filePath, fileId }],
        activeId: newId,
      }));
    },
    [loadDocument, setState],
  );

  return { newDocument, serializeDocument, save, saveAs, loadDocument, openFile };
}

async function saveAsImpl(
  platform: Platform | undefined,
  stateRef: React.MutableRefObject<EditorState>,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
  patch: (partial: Partial<EditorState>) => void,
): Promise<boolean> {
  if (!platform) {
    patch({ saveState: 'error' });
    return false;
  }
  patch({ saveState: 'saving' });
  try {
    const s = stateRef.current;
    const meta = s.sessions.find((sess) => sess.id === s.activeId);
    const json = DocumentCodec.encode(s.document);
    const filePath = await platform.saveDocumentToDisk(meta?.name ?? 'Untitled', json);
    if (filePath) {
      await recoveryRef.current?.deleteSession(s.activeId);
      const fileId = crypto.randomUUID();
      patch({
        dirty: false,
        saveState: 'saved',
        lastSavedAt: Date.now(),
        sessions: s.sessions.map((sess) =>
          sess.id === s.activeId ? { ...sess, dirty: false, filePath, fileId } : sess,
        ),
      });
      return true;
    }
    patch({ saveState: 'idle' });
    return false;
  } catch {
    patch({ saveState: 'error' });
    return false;
  }
}
```

- [ ] **Step 2: Wire the hook into EditorProvider**

Replace inline save/load methods with `usePersistence` calls. Remove the module-level `saveAsImpl`.

Replace the EditorProvider body to call:
```ts
const {
  newDocument,
  serializeDocument,
  save,
  saveAs,
  loadDocument,
  openFile,
} = usePersistence(
  state, setState, patch, stateRef, platform, autoSaveRef, recoveryRef,
);
```

Remove the no-longer-needed imports from the context.tsx top:
- `createDocument` import stays (used in state init)
- `DocumentCodec` import may still be needed elsewhere
- `migrateDocument` import

Remove the module-level `saveAsImpl` function.

Update the useMemo value to reference the returned functions.

- [ ] **Step 3: Run verification**

```bash
pnpm typecheck --filter @varve/editor
pnpm test --filter @varve/editor -- --run
pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/context/usePersistence.ts packages/editor/src/context.tsx
git commit -m "refactor: extract save/load/persistence into usePersistence hook"
```

### Task 2: Extract Background Removal hook

**Files:**
- Create: `packages/editor/src/context/useBackgroundRemoval.ts`
- Modify: `packages/editor/src/context.tsx`

- [ ] **Step 1: Create the background removal hook**

Similar pattern: extract removeBackground, removeBackgroundWithOptions, cancelBackgroundRemoval, setShowOriginalBg, setRefineMaskOptions, refineHairEdges, startTrimapEdit, applyTrimapMatting, confirmSubjectPicker, cancelSubjectPicker, getTrimapData, setTrimapData, setTrimapEditOptions, setBrushSetting.

(Implementation follows the same pattern as Task 1 — too large to fully inline here but follows identical structure.)

- [ ] **Step 2: Wire into EditorProvider**

- [ ] **Step 3: Verify**

- [ ] **Step 4: Commit**

### Task 3: Verify full quality gate

- [ ] **Run: `pnpm typecheck` (editor/15 packages)**
- [ ] **Run: `pnpm test --filter @varve/editor -- --run`**
- [ ] **Run: `pnpm lint` (0 new errors)**
- [ ] **Run: `pnpm audit:emoji`**
- [ ] **Run: `pnpm audit:tokens`**
