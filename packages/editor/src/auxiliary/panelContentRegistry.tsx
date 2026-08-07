/**
 * Panel content registry — panelTypeId → real component for auxiliary
 * windows (ADR-0019).
 *
 * Panels render inside a real EditorProvider (mounted by AuxiliaryShell),
 * so editor-coupled panels work unchanged. Props-driven panels get thin
 * adapters that pull their props from the same editor context.
 */

import type { ReactNode } from 'react';
import { CodePanel } from '../components/CodePanel/CodePanel';
import { PropertiesPanel } from '../components/Inspector/PropertiesPanel';
import { LayersPanel } from '../components/LayersPanel';
import { LogoPanel } from '../components/LogoPanel/LogoPanel';
import { PageNav } from '../components/PageNav/PageNav';
import { ResourcesPanel } from '../components/ResourcesPanel/ResourcesPanel';
import { useEditor } from '../context';
import type { PanelTypeId } from '../workspace/panelRegistry';

// ---------------------------------------------------------------------------
// Props-driven adapters
// ---------------------------------------------------------------------------

function CodePanelAdapter(): ReactNode {
  const { state, selectedNodes } = useEditor();
  return <CodePanel doc={state.document} selection={selectedNodes()} />;
}

function ResourcesPanelAdapter(): ReactNode {
  const { state, installLibrary, uninstallLibrary } = useEditor();
  return (
    <ResourcesPanel
      doc={state.document}
      onInstallLibrary={installLibrary}
      onUninstallLibrary={uninstallLibrary}
    />
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const AUXILIARY_PANEL_RENDERERS: Partial<Record<PanelTypeId, () => ReactNode>> = {
  layers: () => <LayersPanel />,
  inspector: () => <PropertiesPanel />,
  library: ResourcesPanelAdapter,
  codegen: CodePanelAdapter,
  logo: () => <LogoPanel />,
  pagenav: () => <PageNav />,
};

/** Render a panel by type id; null when unsupported in auxiliary windows. */
export function renderAuxiliaryPanel(panelTypeId: string): ReactNode | null {
  const renderer = AUXILIARY_PANEL_RENDERERS[panelTypeId as PanelTypeId];
  if (!renderer) return null;
  return renderer();
}
