// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, Fragment, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShineBorder } from './ShineBorder';

afterEach(cleanup);

describe('ShineBorder', () => {
  it('decorates the child without adding a wrapper or changing semantics', () => {
    const { container } = render(
      <ShineBorder>
        <button type="button">Export</button>
      </ShineBorder>,
    );

    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild?.tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: 'Export' })).toHaveClass(
      'varve-shine-border',
      'varve-shine-border--subtle',
      'varve-shine-border--tone-accent',
      'varve-shine-border--active',
    );
  });

  it('preserves the child ref and click handler', () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(
      <ShineBorder variant="beam" tone="success">
        <button ref={ref} type="button" onClick={onClick}>
          Reveal output
        </button>
      </ShineBorder>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reveal output' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Reveal output' }));
  });

  it('merges child and decorator classes', () => {
    render(
      <ShineBorder className="workflow-emphasis" variant="static">
        <section className="export-results" aria-label="Export results" />
      </ShineBorder>,
    );

    expect(screen.getByRole('region', { name: 'Export results' })).toHaveClass(
      'export-results',
      'workflow-emphasis',
      'varve-shine-border--static',
    );
  });

  it('keeps active and disabled decoration state separate from child semantics', () => {
    const { rerender } = render(
      <ShineBorder active={false}>
        <button type="button">Apply</button>
      </ShineBorder>,
    );
    const button = screen.getByRole('button', { name: 'Apply' });
    expect(button).not.toHaveClass('varve-shine-border--active');
    expect(button).not.toBeDisabled();

    rerender(
      <ShineBorder disabled>
        <button type="button">Apply</button>
      </ShineBorder>,
    );
    expect(button).toHaveClass('varve-shine-border--disabled');
    expect(button).not.toHaveClass('varve-shine-border--active');
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('rejects fragments and multiple children because they cannot inherit the host box', () => {
    expect(() =>
      render(
        <ShineBorder>
          {
            (
              <Fragment>
                <span>One</span>
                <span>Two</span>
              </Fragment>
            ) as ReactElement<{ className?: string }>
          }
        </ShineBorder>,
      ),
    ).toThrow(/exactly one className-forwarding host element/i);

    expect(() =>
      render(
        <ShineBorder>
          {
            [<span key="one">One</span>, <span key="two">Two</span>] as unknown as ReactElement<{
              className?: string;
            }>
          }
        </ShineBorder>,
      ),
    ).toThrow(/exactly one className-forwarding host element/i);
  });
});
