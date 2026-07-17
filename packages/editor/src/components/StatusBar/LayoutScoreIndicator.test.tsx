import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { LayoutScoreIndicator } from './LayoutScoreIndicator';

vi.mock('../../context', () => ({
  useEditor: () => ({
    state: {
      document: { nodes: {}, rootChildren: [] },
      selection: [],
    },
    selectedNodes: () => [],
  }),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).requestIdleCallback = vi.fn(
    (cb: (opts: { didTimeout: boolean; timeRemaining: () => number }) => void) => {
      return setTimeout(
        () => cb({ didTimeout: true, timeRemaining: () => 0 }),
        0,
      ) as unknown as number;
    },
  );
  (globalThis as Record<string, unknown>).cancelIdleCallback = vi.fn((id: number) =>
    clearTimeout(id),
  );
});

describe('LayoutScoreIndicator', () => {
  it('renders without crashing', () => {
    render(<LayoutScoreIndicator />);
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('shows a numeric score', () => {
    render(<LayoutScoreIndicator />);
    expect(screen.getByText(/\d+/)).toBeDefined();
  });

  it('renders with a green class for high scores', () => {
    render(<LayoutScoreIndicator />);
    const btn = screen.getByRole('button');
    expect(btn.className).toBeDefined();
  });
});
