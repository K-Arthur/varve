/**
 * Panel content registry — panelTypeId → real component for auxiliary
 * windows (ADR-0019).
 *
 * Panels render inside a real EditorProvider (mounted by AuxiliaryShell),
 * so editor-coupled panels work unchanged. Props-driven panels get thin
 * adapters that pull their props from the same editor context.
 */

import type { ComponentType, ReactNode } from 'react';
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

function CodePanelAdapter() {
  const { state, selectedNodes } = useEditor();
  return <CodePanel doc={state.document} selection={selectedNodes()} />;
}

function ResourcesPanelAdapter() {
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

export type AuxiliaryPanelRenderer = ComponentType;

export const AUXILIARY_PANEL_RENDERERS: Partial<Record<PanelTypeId, AuxiliaryPanelRenderer>> = {
  layers: LayersPanel,
  inspector: PropertiesPanel,
  library: ResourcesPanelAdapter,
  codegen: CodePanelAdapter,
  logo: LogoPanel,
  pagenav: PageNav,
};

/** Render a panel by type id; null when unsupported in auxiliary windows. */
export function renderAuxiliaryPanel(panelTypeId: string): ReactNode | null {
  const Renderer = AUXILIARY_PANEL_RENDERERS[panelTypeId as PanelTypeId];
  return Renderer ? <Renderer /> : null;
}
