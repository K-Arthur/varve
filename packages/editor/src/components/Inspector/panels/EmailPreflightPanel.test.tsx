// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { EmailDiagnostic } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { EmailPreflightPanel } from './EmailPreflightPanel';

function diagnostic(overrides: Partial<EmailDiagnostic> = {}): EmailDiagnostic {
  return {
    severity: 'warning',
    code: 'SOME_CODE',
    message: 'Something to look at.',
    category: 'compatibility',
    ...overrides,
  };
}

describe('EmailPreflightPanel', () => {
  it('summarises counts so readiness is legible without expanding anything', () => {
    render(
      <EmailPreflightPanel
        diagnostics={[
          diagnostic({ severity: 'error', category: 'link' }),
          diagnostic({ severity: 'warning', category: 'accessibility' }),
          diagnostic({ severity: 'warning', category: 'accessibility', code: 'OTHER' }),
          diagnostic({ severity: 'info', category: 'css' }),
        ]}
      />,
    );

    expect(screen.getByTestId('email-preflight-summary')).toHaveTextContent(
      '1 error, 2 warnings, 1 note',
    );
  });

  it('says so plainly when nothing is wrong, without overclaiming client support', () => {
    render(<EmailPreflightPanel diagnostics={[]} />);

    expect(screen.getByTestId('email-preflight-summary')).toHaveTextContent('No issues');
    // Browser preview is one validation layer, not proof of inbox rendering.
    expect(screen.getByText(/not a guarantee/i)).toBeVisible();
  });

  it('ranks a category holding an error above one holding only notes', () => {
    render(
      <EmailPreflightPanel
        diagnostics={[
          diagnostic({ severity: 'info', category: 'css', message: 'A fallback was applied.' }),
          diagnostic({ severity: 'error', category: 'link', message: 'This link is broken.' }),
        ]}
      />,
    );

    const headings = screen.getAllByRole('heading', { level: 4 }).map((node) => node.textContent);
    expect(headings[0]).toContain('Links');
    expect(headings[1]).toContain('Styling');
  });

  it('puts the worst finding first inside a group', () => {
    render(
      <EmailPreflightPanel
        diagnostics={[
          diagnostic({ severity: 'info', category: 'link', message: 'Just a note.' }),
          diagnostic({ severity: 'error', category: 'link', code: 'B', message: 'A real error.' }),
        ]}
      />,
    );

    const items = screen.getAllByRole('listitem').filter((node) => node.textContent?.includes('.'));
    expect(items[0]?.textContent).toContain('A real error.');
  });

  it('navigates to the offending object when a finding is activated', () => {
    const onSelectNode = vi.fn();
    render(
      <EmailPreflightPanel
        diagnostics={[diagnostic({ sourceNodeId: 'node-1', message: 'Missing alt text.' })]}
        resolvableNodeIds={new Set(['node-1'])}
        onSelectNode={onSelectNode}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Missing alt text/ }));
    expect(onSelectNode).toHaveBeenCalledWith('node-1');
  });

  it('does not offer navigation to a node that no longer exists', () => {
    const onSelectNode = vi.fn();
    render(
      <EmailPreflightPanel
        diagnostics={[diagnostic({ sourceNodeId: 'deleted', message: 'Stale finding.' })]}
        resolvableNodeIds={new Set(['still-here'])}
        onSelectNode={onSelectNode}
      />,
    );

    expect(screen.queryByRole('button', { name: /Stale finding/ })).toBeNull();
    expect(screen.getByText('Stale finding.')).toBeVisible();
  });

  it('shows the suggested fix alongside the finding', () => {
    render(
      <EmailPreflightPanel
        diagnostics={[
          diagnostic({
            message: 'Image has no alt text.',
            suggestedFix: 'Add descriptive alt text.',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Add descriptive alt text.')).toBeVisible();
  });

  it('names the severity in words, not colour alone', () => {
    render(<EmailPreflightPanel diagnostics={[diagnostic({ severity: 'error' })]} />);

    const group = screen.getByRole('region', { name: 'Preflight' });
    expect(within(group).getByText('Error')).toBeVisible();
  });
});
