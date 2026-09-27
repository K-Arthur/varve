// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceBottomPanels } from './WorkspaceBottomPanels';

vi.mock('../Inspector/panels/EmailPreviewPanel', () => ({
  EmailPreviewPanel: () => <section aria-label="Email Preview" />,
}));

describe('WorkspaceBottomPanels', () => {
  it('mounts the configured Email Preview alongside an existing timeline', () => {
    render(
      <WorkspaceBottomPanels showEmailPreview>
        <div data-testid="timeline-content" />
      </WorkspaceBottomPanels>,
    );

    expect(screen.getByTestId('workspace-bottom-panels')).toHaveClass(
      'workspace-bottom-panels--split',
    );
    expect(screen.getByTestId('timeline-content')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Email Preview' })).toBeInTheDocument();
  });

  it('renders Email Preview without forcing a timeline panel to be visible', () => {
    render(<WorkspaceBottomPanels showEmailPreview />);

    expect(screen.getByRole('region', { name: 'Email Preview' })).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-content')).toBeNull();
  });
});
