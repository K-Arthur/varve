/**
 * Built-in panel definitions (ADR-0019).
 *
 * Registers exactly the seven panels of the existing `PanelId` union so the
 * registry and the shell can never drift (assertPanelInvariants enforces
 * the identity of the two sets).
 *
 * Every panel starts with `detachable: false`: detachment flips on
 * per-panel in M7, only after the panel's `DetachablePanelLifecycle` and
 * local-state codec are implemented and covered by tests.
 *
 * Metadata mirrors the 2026-08-05 audit:
 * - layers/inspector stay mounted when hidden (inactivePolicy
 *   'keep-mounted'); library/codegen/logo/timeline/pagenav unmount
 *   ('unmount-with-state' — local state is lost today and must not be
 *   silently retained).
 * - Width floors come from PANEL_LIMITS (layers 180, inspector 240).
 */

import { type PanelDefinition, type PanelTypeId, registerPanel } from './panelRegistry';

export const ALL_PANEL_TYPES: readonly PanelTypeId[] = [
  'layers',
  'inspector',
  'timeline',
  'pagenav',
  'library',
  'codegen',
  'logo',
  'history',
] as const;

const definitions: PanelDefinition[] = [
  {
    id: 'layers',
    title: 'Layers',
    instancePolicy: 'singleton',
    documentRequirement: 'active-document',
    selectionScope: 'shared',
    allowedHosts: ['primary-sidebar', 'auxiliary-window'],
    detachable: false,
    dockable: true,
    minimumSize: { width: 180, height: 160 },
    preferredSize: { width: 288, height: 480 },
    loadPolicy: 'eager',
    inactivePolicy: 'keep-mounted',
    capabilities: {
      requiresCanvas: false,
      requiresRenderer: false,
      requiresModels: false,
      supportsMultipleInstances: false,
      supportsDocumentPinning: false,
    },
    a11yLabels: {
      detach: 'Detach Layers panel',
      reattach: 'Reattach Layers panel',
      moveTo: 'Move Layers panel to another window',
      close: 'Close Layers panel',
    },
    emptyState: { title: 'No layers', description: 'The document has no layers yet.' },
  },
  {
    id: 'inspector',
    title: 'Inspector',
    instancePolicy: 'singleton',
    documentRequirement: 'active-document',
    selectionScope: 'shared',
    allowedHosts: ['primary-sidebar', 'auxiliary-window'],
    detachable: false,
    dockable: true,
    minimumSize: { width: 240, height: 160 },
    preferredSize: { width: 320, height: 560 },
    loadPolicy: 'eager',
    inactivePolicy: 'keep-mounted',
    capabilities: {
      requiresCanvas: false,
      requiresRenderer: false,
      requiresModels: false,
      supportsMultipleInstances: false,
      supportsDocumentPinning: false,
    },
    a11yLabels: {
      detach: 'Detach Inspector panel',
      reattach: 'Reattach Inspector panel',
      moveTo: 'Move Inspector panel to another window',
      close: 'Close Inspector panel',
    },
    emptyState: {
      title: 'Nothing selected',
      description: 'Select an object to inspect its properties.',
    },
  },
  {
    id: 'timeline',
    title: 'Timeline',
    instancePolicy: 'singleton',
    documentRequirement: 'active-document',
    selectionScope: 'shared',
    allowedHosts: ['primary-sidebar', 'auxiliary-window'],
    detachable: false,
    dockable: true,
    minimumSize: { width: 320, height: 120 },
    preferredSize: { width: 720, height: 240 },
    loadPolicy: 'lazy',
    inactivePolicy: 'unmount-with-state',
    capabilities: {
      requiresCanvas: false,
      requiresRenderer: false,
      requiresModels: false,
      supportsMultipleInstances: false,
      supportsDocumentPinning: false,
    },
    a11yLabels: {
      detach: 'Detach Timeline panel',
      reattach: 'Reattach Timeline panel',
      moveTo: 'Move Timeline panel to another window',
      close: 'Close Timeline panel',
    },
  },
  {
    id: 'pagenav',
    title: 'Pages',
    instancePolicy: 'singleton',
    documentRequirement: 'active-document',
    selectionScope: 'none',
    allowedHosts: ['primary-sidebar', 'auxiliary-window'],
    detachable: false,
    dockable: true,
    minimumSize: { width: 160, height: 100 },
    preferredSize: { width: 220, height: 140 },
    loadPolicy: 'lazy',
    inactivePolicy: 'unmount-with-state',
    capabilities: {
      requiresCanvas: false,
      requiresRenderer: false,
      requiresModels: false,
      supportsMultipleInstances: false,
      supportsDocumentPinning: false,
    },
    a11yLabels: {
      detach: 'Detach Pages panel',
      reattach: 'Reattach Pages panel',
      moveTo: 'Move Pages panel to another window',
      close: 'Close Pages panel',
    },
  },
  {
    id: 'library',
    title: 'Assets',
    instancePolicy: 'singleton',
    documentRequirement: 'active-document',
    selectionScope: 'none',
    allowedHosts: ['primary-sidebar', 'auxiliary-window'],
    detachable: false,
    dockable: true,
    minimumSize: { width: 220, height: 160 },
    preferredSize: { width: 300, height: 480 },
    loadPolicy: 'lazy',
    inactivePolicy: 'unmount-with-state',
    capabilities: {
      requiresCanvas: false,
      requiresRenderer: false,
      requiresModels: false,
      supportsMultipleInstances: false,
      supportsDocumentPinning: false,
    },
    a11yLabels: {
      detach: 'Detach Assets panel',
      reattach: 'Reattach Assets panel',
      moveTo: 'Move Assets panel to another window',
      close: 'Close Assets panel',
    },
    emptyState: { title: 'No assets', description: 'Import images and icons to reuse them.' },
  },
  {
    id: 'codegen',
    title: 'Code',
    instancePolicy: 'singleton',
    documentRequirement: 'active-document',
    selectionScope: 'shared',
    allowedHosts: ['primary-sidebar', 'auxiliary-window'],
    detachable: false,
    dockable: true,
    minimumSize: { width: 260, height: 160 },
    preferredSize: { width: 360, height: 480 },
    loadPolicy: 'lazy',
    inactivePolicy: 'unmount-with-state',
    capabilities: {
      requiresCanvas: false,
      requiresRenderer: false,
      requiresModels: false,
      supportsMultipleInstances: false,
      supportsDocumentPinning: false,
    },
    a11yLabels: {
      detach: 'Detach Code panel',
      reattach: 'Reattach Code panel',
      moveTo: 'Move Code panel to another window',
      close: 'Close Code panel',
    },
  },
  {
    id: 'logo',
    title: 'Logo',
    instancePolicy: 'singleton',
    documentRequirement: 'active-document',
    selectionScope: 'shared',
    allowedHosts: ['primary-sidebar', 'auxiliary-window'],
    detachable: false,
    dockable: true,
    minimumSize: { width: 240, height: 160 },
    preferredSize: { width: 320, height: 480 },
    loadPolicy: 'lazy',
    inactivePolicy: 'unmount-with-state',
    capabilities: {
      requiresCanvas: false,
      requiresRenderer: false,
      requiresModels: false,
      supportsMultipleInstances: false,
      supportsDocumentPinning: false,
    },
    a11yLabels: {
      detach: 'Detach Logo panel',
      reattach: 'Reattach Logo panel',
      moveTo: 'Move Logo panel to another window',
      close: 'Close Logo panel',
    },
  },
  {
    id: 'history',
    title: 'History',
    icon: 'Clock',
    instancePolicy: 'singleton',
    documentRequirement: 'active-document',
    selectionScope: 'none',
    allowedHosts: ['primary-sidebar', 'auxiliary-window'],
    detachable: false,
    dockable: true,
    minimumSize: { width: 200, height: 120 },
    preferredSize: { width: 280, height: 320 },
    loadPolicy: 'lazy',
    inactivePolicy: 'unmount-with-state',
    capabilities: {
      requiresCanvas: false,
      requiresRenderer: false,
      requiresModels: false,
      supportsMultipleInstances: false,
      supportsDocumentPinning: false,
    },
    a11yLabels: {
      detach: 'Detach History panel',
      reattach: 'Reattach History panel',
      moveTo: 'Move History panel to another window',
      close: 'Close History panel',
    },
    emptyState: { title: 'No history', description: 'Open a document to see revision history.' },
  },
];

export function registerBuiltinPanels(): void {
  for (const def of definitions) {
    registerPanel(def);
  }
}

/** The canonical, ordered panel type set (mirrors the PanelId union). */
export function listBuiltinPanelTypes(): readonly PanelTypeId[] {
  return ALL_PANEL_TYPES;
}
