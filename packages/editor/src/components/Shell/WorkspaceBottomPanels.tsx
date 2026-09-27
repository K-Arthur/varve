import type { ReactNode } from 'react';
import { EmailPreviewPanel } from '../Inspector/panels/EmailPreviewPanel';
import './WorkspaceBottomPanels.css';

export interface WorkspaceBottomPanelsProps {
  showEmailPreview: boolean;
  children?: ReactNode;
}

/** Fixed central-canvas companion slot for timeline and email preview surfaces. */
export function WorkspaceBottomPanels({ showEmailPreview, children }: WorkspaceBottomPanelsProps) {
  const hasTimeline = children !== undefined && children !== null;
  const className = [
    'workspace-bottom-panels',
    showEmailPreview && hasTimeline ? 'workspace-bottom-panels--split' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} data-testid="workspace-bottom-panels">
      {hasTimeline && (
        <div className="workspace-bottom-panels__timeline" data-panel="timeline">
          {children}
        </div>
      )}
      {showEmailPreview && (
        <div className="workspace-bottom-panels__email-preview" data-panel="emailPreview">
          <EmailPreviewPanel />
        </div>
      )}
    </div>
  );
}
