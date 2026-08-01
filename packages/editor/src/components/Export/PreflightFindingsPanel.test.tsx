// @vitest-environment jsdom

import type { ExportFinding } from '@strata/scene/export';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreflightFindingsPanel } from './PreflightFindingsPanel';

afterEach(cleanup);

function makeFinding(overrides: Partial<ExportFinding> = {}): ExportFinding {
  return {
    id: 'font-missing:p1:n1',
    code: 'font-missing',
    severity: 'warning',
    title: 'A font is not installed',
    description: 'Font "Arial" is not available on this device.',
    configurationId: 'p1',
    nodeIds: ['n1'],
    canIgnore: true,
    ...overrides,
  };
}

describe('PreflightFindingsPanel', () => {
  it('renders nothing when empty and showClean is off', () => {
    const { container } = render(<PreflightFindingsPanel findings={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the clean state when showClean is on', () => {
    render(<PreflightFindingsPanel findings={[]} showClean />);
    expect(screen.getByText(/no preflight issues/i)).toBeTruthy();
  });

  it('summarizes counts across severities', () => {
    render(
      <PreflightFindingsPanel
        findings={[
          makeFinding(),
          makeFinding({
            id: 'x:1',
            code: 'format-unsupported',
            severity: 'error',
            title: 'Format unsupported',
          }),
          makeFinding({
            id: 'y:1',
            code: 'info-code',
            severity: 'info',
            title: 'Informational note',
          }),
        ]}
      />,
    );
    expect(screen.getByText(/1 error \u00b7 1 warning \u00b7 1 info/i)).toBeTruthy();
    expect(screen.getByText('Format unsupported')).toBeTruthy();
    expect(screen.getByText('Informational note')).toBeTruthy();
  });

  it('collapses and expands the finding list', () => {
    render(<PreflightFindingsPanel findings={[makeFinding()]} />);
    const toggle = screen.getByRole('button', { name: /preflight:/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders severity labels for assistive tech alongside icons', () => {
    render(
      <PreflightFindingsPanel
        findings={[
          makeFinding({
            id: 'err:1',
            code: 'dimensions-exceed',
            severity: 'error',
            title: 'Output is very large',
          }),
        ]}
      />,
    );
    expect(
      screen.getByText((_content, node) => {
        if (
          !(node instanceof HTMLElement) ||
          !node.classList.contains('preflight-panel__finding-title')
        ) {
          return false;
        }
        return node.textContent?.includes('Error: Output is very large') === true;
      }),
    ).toBeTruthy();
  });

  it('shows the deterministic finding code', () => {
    render(<PreflightFindingsPanel findings={[makeFinding()]} />);
    expect(screen.getByText('font-missing')).toBeTruthy();
  });

  it('exposes a fix button only when a fix action exists and onApplyFix is set', () => {
    const onApplyFix = vi.fn();
    render(
      <PreflightFindingsPanel
        findings={[makeFinding({ fixAction: { type: 'outline-text', nodeIds: ['n1'] } })]}
        onApplyFix={onApplyFix}
      />,
    );
    const fix = screen.getByRole('button', { name: 'Convert text to outlines' });
    fireEvent.click(fix);
    expect(onApplyFix).toHaveBeenCalledOnce();
  });

  it('omits fix buttons when no fix action is available', () => {
    render(
      <PreflightFindingsPanel
        findings={[makeFinding({ fixAction: { type: 'none' } })]}
        onApplyFix={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /outlines/i })).toBeNull();
  });
});
