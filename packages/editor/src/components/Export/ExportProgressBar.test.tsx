// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExportProgressBar } from './ExportProgressBar';

afterEach(cleanup);

describe('ExportProgressBar', () => {
  it('shows correct progress', () => {
    const { container } = render(
      <ExportProgressBar total={10} done={5} errors={0} running={true} onCancel={() => {}} />,
    );
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('5');
    expect(bar?.getAttribute('aria-valuemin')).toBe('0');
    expect(bar?.getAttribute('aria-valuemax')).toBe('10');
    expect(screen.getByText('5/10')).toBeTruthy();
  });

  it('cancel button visible when running', () => {
    render(<ExportProgressBar total={5} done={2} errors={0} running={true} onCancel={() => {}} />);
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('cancel button hidden when not running', () => {
    const { container } = render(
      <ExportProgressBar total={5} done={5} errors={0} running={false} onCancel={() => {}} />,
    );
    expect(container.querySelector('.export-progress__cancel')).toBeNull();
  });

  it('handles errors display', () => {
    render(
      <ExportProgressBar total={10} done={6} errors={2} running={false} onCancel={() => {}} />,
    );
    expect(screen.getByText('(2 errors)')).toBeTruthy();
  });

  it('renders progressbar with proper role', () => {
    const { container } = render(
      <ExportProgressBar total={1} done={0} errors={0} running={false} onCancel={() => {}} />,
    );
    expect(container.querySelector('[role="progressbar"]')).toBeTruthy();
  });

  it('announces the real current stage and file while running', () => {
    render(
      <ExportProgressBar
        total={2}
        done={0}
        errors={0}
        running={true}
        stage="writing"
        currentFile="logo@2x.png"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Writing: logo@2x.png')).toHaveAttribute('aria-live', 'polite');
  });
});
