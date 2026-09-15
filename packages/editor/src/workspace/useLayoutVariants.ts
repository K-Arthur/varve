/**
 * Reactive view of the named-layout store.
 *
 * Subscribes to the layout store so layout surfaces re-render on CRUD,
 * hydration, and reset-snapshot changes without threading layout state
 * through EditorState.
 */

import { useEffect, useState } from 'react';
import {
  getLayoutStore,
  subscribeLayoutStore,
  type WorkspaceLayoutStoreState,
} from './layoutVariants';

export function useLayoutStoreState(): WorkspaceLayoutStoreState {
  const [store, setStore] = useState(getLayoutStore);
  useEffect(() => subscribeLayoutStore(() => setStore(getLayoutStore())), []);
  return store;
}
