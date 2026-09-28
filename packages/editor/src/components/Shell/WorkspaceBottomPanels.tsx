import type { CSSProperties, ReactNode } from 'react';
import type {
  DockTabGroupView,
  EditorDockGeometry,
} from '../../workspace/dock/useEditorDockGeometry';
import { getDockPanelA11yProps } from '../../workspace/dock/useEditorDockGeometry';
import type { PanelId } from '../../workspace/panelIds';
import { tryGetPanelDefinition } from '../../workspace/panelRegistry';
import { EmailOutputPanel } from '../Inspector/panels/EmailOutputPanel';
import { EmailPreviewPanel } from '../Inspector/panels/EmailPreviewPanel';
import './WorkspaceBottomPanels.css';

const DOCK_PANEL_ELEMENT_IDS: Record<PanelId, string> = {
  layers: 'editor-layers-panel',
  inspector: 'editor-inspector-panel',
  timeline: 'editor-timeline-panel',
  pagenav: 'editor-pagenav-panel',
  library: 'editor-library-panel',
  codegen: 'editor-codegen-panel',
  logo: 'editor-logo-panel',
  history: 'editor-history-panel',
  emailPreview: 'editor-email-preview-panel',
  emailOutput: 'editor-email-output-panel',
};

export interface WorkspaceBottomPanelsProps {
  showEmailPreview: boolean;
  showEmailOutput?: boolean;
  panelStyles?: Partial<
    Record<Extract<PanelId, 'timeline' | 'emailPreview' | 'emailOutput'>, CSSProperties>
  >;
  dockTabGroups?: readonly DockTabGroupView[];
  dockSplitters?: EditorDockGeometry['splitters'];
  dockTabPanelA11y?: EditorDockGeometry['tabPanelA11y'];
  onSelectDockTab?: (groupNodeId: string, panelInstanceId: string) => void;
  children?: ReactNode;
}

/** Fixed central-canvas companion slot for timeline and email preview surfaces. */
export function WorkspaceBottomPanels({
  showEmailPreview,
  showEmailOutput = false,
  panelStyles,
  dockTabGroups = [],
  dockSplitters = [],
  dockTabPanelA11y = {},
  onSelectDockTab,
  children,
}: WorkspaceBottomPanelsProps) {
  const hasTimeline = children !== undefined && children !== null;
  const docked = Boolean(
    panelStyles?.timeline || panelStyles?.emailPreview || panelStyles?.emailOutput,
  );
  const className = [
    'workspace-bottom-panels',
    docked ? 'workspace-bottom-panels--docked' : '',
    !hasTimeline && !showEmailPreview && !showEmailOutput && dockTabGroups.length > 0
      ? 'workspace-bottom-panels--controls-only'
      : '',
    showEmailPreview && hasTimeline ? 'workspace-bottom-panels--split' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} data-testid="workspace-bottom-panels">
      {hasTimeline && (
        <section
          className="workspace-bottom-panels__timeline"
          data-panel="timeline"
          id="editor-timeline-panel"
          style={panelStyles?.timeline}
          role={dockTabPanelA11y.timeline ? 'tabpanel' : 'group'}
          {...getDockPanelA11yProps(dockTabPanelA11y.timeline)}
        >
          {children}
        </section>
      )}
      {showEmailPreview && (
        <section
          className="workspace-bottom-panels__email-preview"
          data-panel="emailPreview"
          id="editor-email-preview-panel"
          style={panelStyles?.emailPreview}
          role={dockTabPanelA11y.emailPreview ? 'tabpanel' : 'group'}
          {...getDockPanelA11yProps(dockTabPanelA11y.emailPreview)}
        >
          <EmailPreviewPanel />
        </section>
      )}
      {showEmailOutput && (
        <EmailOutputPanel
          style={panelStyles?.emailOutput}
          dockTabA11y={dockTabPanelA11y.emailOutput}
        />
      )}
      {dockTabGroups.map((group) => (
        <div
          key={group.nodeId}
          className="workspace-dock-tabs"
          style={group.style}
          role="tablist"
          aria-label="Panels in this dock group"
        >
          {group.panels.map((panel, index) => {
            const active = group.activePanelInstanceId === panel.instanceId;
            const title = tryGetPanelDefinition(panel.panelTypeId)?.title ?? panel.panelTypeId;
            return (
              <button
                key={panel.instanceId}
                id={`dock-tab-${group.nodeId}-${panel.instanceId}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={DOCK_PANEL_ELEMENT_IDS[panel.panelTypeId]}
                tabIndex={active ? 0 : -1}
                className="workspace-dock-tabs__tab"
                onClick={() => onSelectDockTab?.(group.nodeId, panel.instanceId)}
                onKeyDown={(event) => {
                  const direction =
                    event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                  const edgeIndex =
                    event.key === 'Home' ? 0 : event.key === 'End' ? group.panels.length - 1 : -1;
                  if (direction === 0 && edgeIndex < 0) return;
                  event.preventDefault();
                  const nextIndex =
                    edgeIndex >= 0
                      ? edgeIndex
                      : (index + direction + group.panels.length) % group.panels.length;
                  const next = group.panels[nextIndex];
                  if (!next) return;
                  onSelectDockTab?.(group.nodeId, next.instanceId);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                    [nextIndex]?.focus();
                }}
              >
                {title}
              </button>
            );
          })}
        </div>
      ))}
      {dockSplitters.map((splitter) => (
        // biome-ignore lint/a11y/useSemanticElements: a focusable resizable pane divider is an ARIA window splitter, not a thematic break.
        <div
          key={splitter.nodeId}
          className="workspace-dock-splitter"
          data-testid={`dock-splitter-${splitter.nodeId}`}
          style={splitter.style}
          role="separator"
          aria-label="Resize dock panels"
          aria-orientation={splitter.orientation}
          aria-valuemin={Math.round(splitter.minRatio * 100)}
          aria-valuemax={Math.round(splitter.maxRatio * 100)}
          aria-valuenow={Math.round(splitter.ratio * 100)}
          aria-valuetext={`${Math.round(splitter.ratio * 100)} percent`}
          tabIndex={0}
          onPointerDown={splitter.onPointerDown}
          onPointerMove={splitter.onPointerMove}
          onPointerUp={splitter.onPointerUp}
          onPointerCancel={splitter.onPointerCancel}
          onLostPointerCapture={splitter.onLostPointerCapture}
          onBlur={splitter.onBlur}
          onKeyDown={splitter.onKeyDown}
        />
      ))}
    </div>
  );
}
