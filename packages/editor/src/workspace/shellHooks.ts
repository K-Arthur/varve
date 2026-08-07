/**
 * Shell hook barrel — consolidates Shell's workspace hook imports.
 *
 * Shell is at its import ceiling (audit-health); grouping the workspace
 * hooks behind one barrel keeps the statement count down without
 * changing behavior.
 */

export { useDetachedPanels } from './useDetachedPanels';
export { useEffectiveWorkspaceConfig } from './useWorkspaceConfig';
export { useWorkspacePanelWidths } from './useWorkspacePanelWidths';
