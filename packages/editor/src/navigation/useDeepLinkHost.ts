/**
 * useDeepLinkHost — wires typed deep links into the running editor.
 *
 * Lives in its own module so Shell.tsx doesn't grow imports: this hook
 * owns the editor-context registration, the web listeners (hashchange /
 * popstate), the host-app `varve:deep-link` custom event, the Tauri
 * `deep-link` listener with lifecycle teardown, and the cross-document
 * open-or-cancel path via the platform facade.
 *
 * Teardown guarantees (acceptance criterion 12):
 * - web listeners are removed,
 * - the Tauri unlisten() promise is awaited and invoked,
 * - a parked (document-not-loaded) link is cancelled.
 */

import type { Platform } from '@varve/platform';
import type { AuditFinding } from '@varve/scene';
import { useCallback, useEffect } from 'react';
import { getFindings } from '../audit/findingsRegistry';
import {
  type DeepLinkDeps,
  handleDeepLink,
  setCachedEditorContext,
  setupDeepLinkListener,
} from './deepLinkHandler';
import type { NavigationEditorContext } from './navigationCoordinator';
import { useFindingNavigation } from './useFindingNavigation';

export function useDeepLinkHost(
  editor: NavigationEditorContext,
  platform: Platform | undefined,
): void {
  const { navigateToFinding } = useFindingNavigation();

  const openDocument = useCallback(
    async (documentId: string, name?: string): Promise<boolean> => {
      if (!platform) return false;
      const json = await platform.readFile(documentId).catch(() => null);
      if (!json) return false;
      editor.openFile(documentId, name ?? 'Untitled', undefined, json);
      return true;
    },
    [platform, editor],
  );

  const deps = useCallback(
    (): DeepLinkDeps => ({
      getFindings: () => getFindings(),
      navigateToFinding: (finding: AuditFinding) => {
        void navigateToFinding(finding, [...getFindings()]);
      },
      openDocument,
    }),
    [navigateToFinding, openDocument],
  );

  useEffect(() => {
    setCachedEditorContext(editor);
    const teardownWeb = setupDeepLinkListener(deps);

    const onCustomEvent = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      const href = typeof detail === 'string' ? detail : (detail as { url?: string } | null)?.url;
      if (typeof href === 'string') void handleDeepLink(href, deps());
    };
    window.addEventListener('varve:deep-link', onCustomEvent);

    return () => {
      window.removeEventListener('varve:deep-link', onCustomEvent);
      teardownWeb();
      setCachedEditorContext(null);
    };
  }, [editor, deps]);
}
