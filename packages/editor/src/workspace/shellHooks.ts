import { type CSSProperties, type RefObject, useCallback, useEffect, useRef } from 'react';

/** Keep drawer width independent of the collapsed desktop grid column. */
export function layersDrawerStyle(
  dockStyle: CSSProperties | undefined,
  width: number | null,
  preferredWidth: string | undefined,
): CSSProperties {
  return {
    ...dockStyle,
    '--layers-drawer-width': width === null ? preferredWidth : `${width}px`,
  } as CSSProperties;
}

const RESPONSIVE_DRAWER_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

export function getResponsiveDrawerFocusable(container: HTMLElement): HTMLElement[] {
  const ownerWindow = container.ownerDocument.defaultView;
  return Array.from(container.querySelectorAll<HTMLElement>(RESPONSIVE_DRAWER_FOCUSABLE)).filter(
    (element) => {
      let current: Element | null = element;
      while (current && current !== container.parentElement) {
        const style = ownerWindow?.getComputedStyle(current);
        if (style?.display === 'none' || style?.visibility === 'hidden') return false;
        current = current.parentElement;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
  );
}

type ResponsivePanelClosersOptions = {
  layersVisible: boolean;
  inspectorVisible: boolean;
  libraryPanelVisible: boolean;
  setLayersVisible: (visible: boolean) => void;
  setInspectorVisible: (visible: boolean) => void;
  toggleLibraryPanel: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

/** Close a drawer and restore focus without conflating its close controls. */
export function useResponsivePanelClosers({
  layersVisible,
  inspectorVisible,
  libraryPanelVisible,
  setLayersVisible,
  setInspectorVisible,
  toggleLibraryPanel,
  triggerRef,
}: ResponsivePanelClosersOptions) {
  const restoreTriggerFocus = useCallback(() => {
    const trigger = triggerRef.current;
    window.requestAnimationFrame(() => trigger?.focus());
  }, [triggerRef]);

  const closeResponsivePanels = useCallback(() => {
    if (!layersVisible && !inspectorVisible && !libraryPanelVisible) return;
    setLayersVisible(false);
    setInspectorVisible(false);
    if (libraryPanelVisible) toggleLibraryPanel();
    restoreTriggerFocus();
  }, [
    inspectorVisible,
    layersVisible,
    libraryPanelVisible,
    restoreTriggerFocus,
    setInspectorVisible,
    setLayersVisible,
    toggleLibraryPanel,
  ]);

  const closeResponsiveInspector = useCallback(() => {
    setInspectorVisible(false);
    restoreTriggerFocus();
  }, [restoreTriggerFocus, setInspectorVisible]);

  const closeResponsiveLayers = useCallback(() => {
    setLayersVisible(false);
    restoreTriggerFocus();
  }, [restoreTriggerFocus, setLayersVisible]);

  return { closeResponsivePanels, closeResponsiveInspector, closeResponsiveLayers };
}

/** E4 (2026-08-10): document-level heading label for SR heading navigation. */
export function editorHeadingLabel(
  sessions: { id: string; name: string }[],
  activeId: string | null,
): string {
  const name = sessions.find((s) => s.id === activeId)?.name;
  return name ? `${name} — Varve` : 'Varve editor';
}

type FitEditor = {
  state: { document: { nodes: Record<string, unknown> } };
  fitAll: () => void;
};

/** Fit a newly loaded document once the canvas has a measurable viewport. */
export function useFitOnFirstDocument(editor: FitEditor, enabled: boolean): void {
  const fittedRef = useRef(false);
  const hasNodes = Object.keys(editor.state.document.nodes).length > 0;
  const fitAllRef = useRef(editor.fitAll);
  fitAllRef.current = editor.fitAll;

  useEffect(() => {
    if (!enabled || fittedRef.current || !hasNodes) return;
    let frame = 0;
    let attempts = 0;
    const tryFit = () => {
      const canvas = document.querySelector<HTMLElement>('.editor-canvas');
      if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        fittedRef.current = true;
        fitAllRef.current();
        return;
      }
      if (++attempts > 300) return;
      frame = requestAnimationFrame(tryFit);
    };
    frame = requestAnimationFrame(tryFit);
    return () => cancelAnimationFrame(frame);
  }, [enabled, hasNodes]);
}

/**
 * Shell hook barrel — consolidates Shell's workspace hook imports.
 *
 * Shell is at its import ceiling (audit-health); grouping the workspace
 * hooks behind one barrel keeps the statement count down without
 * changing behavior.
 */

export { getDockPanelA11yProps, useEditorDockGeometry } from './dock/useEditorDockGeometry';
export { useDetachedPanels } from './useDetachedPanels';
export {
  isPagePanelUserControlled,
  resolvePageSurfaceVisibility,
  useEffectiveWorkspaceConfig,
} from './useWorkspaceConfig';
export { useWorkspacePanelWidths } from './useWorkspacePanelWidths';
