/**
 * useDocumentAccent — wires the editor shell into the document-accent
 * controller without adding imports to any hub file.
 *
 * Mounted once from the status bar (always present in the editor shell):
 * it publishes the extractable surface (active page + document revision) and
 * re-applies overrides when the resolved theme changes. The preference
 * itself arrives through the settings application path (SettingsContext),
 * so the two sides stay decoupled and every consumer of
 * `useEditor()`-scoped state stays out of the settings package.
 */

import { THUMBNAIL_VARIANTS } from '@varve/shared';
import { THEME_CHANGE_EVENT } from '@varve/ui/tokens';
import { useEffect } from 'react';
import { documentRevisionHash } from '../thumbnail/identity';
import { renderDocThumbnail } from '../thumbnail/thumbnailService';
import { type DocumentAccentContext, documentAccentController } from './documentAccent';

export function useDocumentAccent(
  document: Parameters<typeof renderDocThumbnail>[0],
  currentPageId: string | null,
): void {
  useEffect(() => {
    if (!document) {
      documentAccentController.setDocumentContext(null);
      return;
    }
    let disposed = false;
    const key = `${documentRevisionHash(document)}:${currentPageId ?? ''}`;
    const context: DocumentAccentContext = {
      key,
      render: async () => {
        if (disposed) return null;
        const outcome = await renderDocThumbnail(document, {
          // The active page is the content the operator sees; extraction must
          // not sample hidden pages just because their pixels are computable.
          ...(currentPageId ? { source: { type: 'page', pageId: currentPageId } as const } : {}),
          variant: THUMBNAIL_VARIANTS['page-nav'],
        });
        return outcome.result?.dataUrl ?? null;
      },
    };
    documentAccentController.setDocumentContext(context);
    return () => {
      disposed = true;
    };
  }, [document, currentPageId]);

  useEffect(() => {
    const onThemeChange = () => documentAccentController.themeChanged();
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  }, []);

  useEffect(() => {
    return () => documentAccentController.setDocumentContext(null);
  }, []);
}
