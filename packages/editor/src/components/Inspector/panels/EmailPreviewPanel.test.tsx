import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmailPreviewPanel } from './EmailPreviewPanel';

vi.mock('../../../context', () => ({
  useEditor: () => ({
    selectedNodes: () => [],
    state: { document: {} },
  }),
}));

vi.mock('../../../workspace/panelLocalState', () => ({
  usePanelLocalState: (_owner: string, _key: string, initial: unknown) => [initial, vi.fn()],
}));

vi.mock('./emailCompilation', () => ({
  getEmailCompilation: () => null,
}));

describe('EmailPreviewPanel', () => {
  it('exposes the viewport switch as a named, stateful button group', () => {
    render(<EmailPreviewPanel />);

    expect(screen.getByRole('group', { name: 'Preview width' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Desktop' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mobile' })).toHaveAttribute('aria-pressed', 'false');
  });
});
