// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

import { useEditor } from '../../context';
import { PanelHostProvider } from '../../workspace/PanelHostContext';
import { EffectStudioLauncher } from './EffectStudioLauncher';

describe('EffectStudioLauncher', () => {
  let openEffectStudioDialog = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    openEffectStudioDialog = vi.fn();
    vi.mocked(useEditor).mockReturnValue({
      openEffectStudioDialog,
    } as unknown as ReturnType<typeof useEditor>);
  });

  it('opens the controlled dialog directly from the current editor context', () => {
    render(<EffectStudioLauncher />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Effect Studio' }));

    expect(openEffectStudioDialog).toHaveBeenCalledOnce();
  });

  it('does not offer a primary-editor dialog from a detached panel host', () => {
    render(
      <PanelHostProvider windowId="aux-inspector" isAuxiliary>
        <EffectStudioLauncher />
      </PanelHostProvider>,
    );

    const launcher = screen.getByRole('button', { name: 'Open Effect Studio' });
    expect(launcher).toBeDisabled();
    expect(launcher).toHaveAttribute('aria-describedby', 'effect-studio-dialog-unavailable');
  });
});
