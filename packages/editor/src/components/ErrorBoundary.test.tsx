import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb({ shouldThrow }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error('Boom');
  return <div>OK</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    const { container } = render(
      <ErrorBoundary>
        <div>Hello</div>
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('Hello');
  });

  it('renders fallback on error', () => {
    const { container } = render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('Something went wrong');
    expect(container.querySelector('button')?.textContent).toBe('Reload');
  });

  it('renders custom fallback when provided', () => {
    const { container } = render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('Custom error UI');
  });

  it('calls onError when error occurs', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('reload resets error state and re-mounts children', () => {
    let shouldThrow = true;
    function ConditionalBomb() {
      if (shouldThrow) throw new Error('Boom');
      return <div>Recovered</div>;
    }

    const { container } = render(
      <ErrorBoundary>
        <ConditionalBomb />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('Something went wrong');

    shouldThrow = false;
    const btn = container.querySelector('button');
    expect(btn).toBeTruthy();
    fireEvent.click(btn as HTMLButtonElement);

    expect(container.textContent).toContain('Recovered');
  });

  it('logs error to console.error by default', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
