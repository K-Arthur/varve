// @ts-nocheck
/**
 * ComicWorkspaceSuggestion — profile-aware layout suggestion. It must never
 * switch modes on its own, must offer the matching built-in layout, and must
 * remember a dismissal per profile.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

import { useEditor } from '../../context';
import { ComicWorkspaceSuggestion } from './ComicWorkspaceSuggestion';

function mockEditor(overrides: {
  workflowProfile?: string;
  workspaceMode?: string;
  pages?: unknown[];
  requestWorkspaceSwitch?: ReturnType<typeof vi.fn>;
  applyWorkspaceLayout?: ReturnType<typeof vi.fn>;
}) {
  const requestWorkspaceSwitch =
    overrides.requestWorkspaceSwitch ?? vi.fn().mockResolvedValue(true);
  const applyWorkspaceLayout = overrides.applyWorkspaceLayout ?? vi.fn().mockReturnValue(true);
  vi.mocked(useEditor).mockReturnValue({
    state: {
      workspaceMode: overrides.workspaceMode ?? 'design',
      document: {
        workflowProfile: overrides.workflowProfile ?? 'comic-print',
        pages: overrides.pages ?? [{ id: 'p1' }],
      },
    },
    requestWorkspaceSwitch,
    applyWorkspaceLayout,
  } as unknown as ReturnType<typeof useEditor>);
  return { requestWorkspaceSwitch, applyWorkspaceLayout };
}

describe('ComicWorkspaceSuggestion', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers the matching layout for a comic document without switching modes', () => {
    const { requestWorkspaceSwitch } = mockEditor({});
    render(<ComicWorkspaceSuggestion />);
    expect(screen.getByText(/matching workspace layout/i)).toBeTruthy();
    expect(requestWorkspaceSwitch).not.toHaveBeenCalled();
  });

  it('applies the comic layout only after the user accepts', async () => {
    const { requestWorkspaceSwitch, applyWorkspaceLayout } = mockEditor({});
    render(<ComicWorkspaceSuggestion />);
    fireEvent.click(screen.getByRole('button', { name: /open in draw with layout/i }));
    await waitFor(() => expect(requestWorkspaceSwitch).toHaveBeenCalledWith('drawing'));
    expect(applyWorkspaceLayout).toHaveBeenCalledTimes(1);
    expect(applyWorkspaceLayout.mock.calls[0][0].id).toBe('builtin-comic-print');
  });

  it('uses the webtoon layout for a webtoon profile', async () => {
    const { applyWorkspaceLayout } = mockEditor({ workflowProfile: 'webtoon-vertical' });
    render(<ComicWorkspaceSuggestion />);
    fireEvent.click(screen.getByRole('button', { name: /open in draw with layout/i }));
    await waitFor(() => expect(applyWorkspaceLayout).toHaveBeenCalledTimes(1));
    expect(applyWorkspaceLayout.mock.calls[0][0].id).toBe('builtin-webtoon-vertical');
  });

  it('stays hidden in Draw, without pages, and after dismissal', () => {
    mockEditor({ workspaceMode: 'drawing' });
    const first = render(<ComicWorkspaceSuggestion />);
    expect(first.container.firstChild).toBeNull();
    first.unmount();

    mockEditor({ pages: [] });
    const second = render(<ComicWorkspaceSuggestion />);
    expect(second.container.firstChild).toBeNull();
    second.unmount();

    mockEditor({});
    const third = render(<ComicWorkspaceSuggestion />);
    fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(third.container.firstChild).toBeNull();
    expect(localStorage.getItem('varve-comic-layout-suggestion')).toContain('comic-print');
  });
});
