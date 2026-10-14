import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmailPreviewPanel } from './EmailPreviewPanel';
import { getEmailCompilation } from './emailCompilation';

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
  getEmailCompilation: vi.fn(() => null),
}));

describe('EmailPreviewPanel', () => {
  it('exposes the viewport switch as a named, stateful button group', () => {
    render(<EmailPreviewPanel />);

    expect(screen.getByRole('group', { name: 'Preview width' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Desktop' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mobile' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('inlines packaged preview images when no asset base URL is configured', () => {
    vi.mocked(getEmailCompilation).mockReturnValue({
      ir: {
        assets: [{ filename: 'hero.png', dataUrl: 'data:image/png;base64,AAAA' }],
      },
      output: { html: '<img src="assets/hero.png" />' },
    } as never);

    render(<EmailPreviewPanel />);

    const iframe = screen.getByTitle('Email browser preview');
    expect(iframe).toHaveAttribute('srcdoc', '<img src="data:image/png;base64,AAAA" />');
  });
});
