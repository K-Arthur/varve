import { setDocumentGrid as sceneSetDocumentGrid } from '@strata/scene';
import { useCallback } from 'react';
import type { DocumentGridSettings } from './types';

export interface GridSettingsApi {
  setPixelGridSnapEnabled: (v: boolean) => void;
  resetGridOrigin: () => void;
  setSnapGrid: (v: number) => void;
  setDocumentGrid: (settings: DocumentGridSettings) => void;
}

export function useGridSettings(
  stateRef: { current: { documentGrid: DocumentGridSettings } },
  patch: (partial: {
    documentGrid?: DocumentGridSettings;
    pixelGridSnapEnabled?: boolean;
    snapGrid?: number;
  }) => void,
  updateDoc: (fn: (doc: unknown) => unknown) => void,
  persistViewportPrefs: (state: unknown) => void,
): GridSettingsApi {
  const setPixelGridSnapEnabled = useCallback(
    (v: boolean) => {
      patch({ pixelGridSnapEnabled: v });
      persistViewportPrefs({ ...stateRef.current, pixelGridSnapEnabled: v });
    },
    [patch, persistViewportPrefs, stateRef],
  );

  const resetGridOrigin = useCallback(() => {
    const dg = stateRef.current.documentGrid;
    updateDoc((doc) =>
      sceneSetDocumentGrid(doc as Parameters<typeof sceneSetDocumentGrid>[0], {
        ...dg,
        offsetX: 0,
        offsetY: 0,
      }),
    );
  }, [updateDoc, stateRef]);

  const setSnapGrid = useCallback(
    (v: number) => {
      const clamped = Math.max(1, Math.min(256, Math.round(v)));
      const nextGrid = { ...stateRef.current.documentGrid, spacingX: clamped, spacingY: clamped };
      updateDoc((doc) =>
        sceneSetDocumentGrid(doc as Parameters<typeof sceneSetDocumentGrid>[0], nextGrid),
      );
      patch({ snapGrid: clamped, documentGrid: nextGrid });
      persistViewportPrefs({ ...stateRef.current, snapGrid: clamped, documentGrid: nextGrid });
    },
    [updateDoc, patch, persistViewportPrefs, stateRef],
  );

  const setDocumentGrid = useCallback(
    (settings: DocumentGridSettings) => {
      const grid = {
        ...settings,
        id: settings.id ?? 'grid-document-default',
        type: 'document' as const,
      };
      updateDoc((doc) =>
        sceneSetDocumentGrid(doc as Parameters<typeof sceneSetDocumentGrid>[0], grid),
      );
      patch({ documentGrid: grid });
      persistViewportPrefs({ ...stateRef.current, documentGrid: grid });
    },
    [updateDoc, patch, persistViewportPrefs, stateRef],
  );

  return {
    setPixelGridSnapEnabled,
    resetGridOrigin,
    setSnapGrid,
    setDocumentGrid,
  };
}
