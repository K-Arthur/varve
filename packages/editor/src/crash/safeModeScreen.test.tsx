// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SafeModeScreen } from './safeModeScreen';

describe('SafeModeScreen', () => {
  it('exposes all reversible startup options and deliberate recovery actions', () => {
    const onToggleOption = vi.fn();
    const onContinue = vi.fn();
    const onExit = vi.fn();

    render(
      <SafeModeScreen
        appVersion="0.2.1"
        onExit={onExit}
        onContinue={onContinue}
        onToggleOption={onToggleOption}
      />,
    );

    expect(
      screen.getByRole('alertdialog', { name: 'Varve had trouble starting' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(7);
    expect(
      screen
        .getAllByRole('checkbox')
        .slice(0, 5)
        .every((checkbox) => checkbox.checked),
    ).toBe(true);
    expect(
      screen
        .getAllByRole('checkbox')
        .slice(5)
        .every((checkbox) => !checkbox.checked),
    ).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /disable gpu acceleration/i }));
    expect(onToggleOption).toHaveBeenCalledWith('disableGpu', false);

    fireEvent.click(screen.getByRole('button', { name: /start varve in safe mode/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue normal startup/i }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledOnce();
  });
});
