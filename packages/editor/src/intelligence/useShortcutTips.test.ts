/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as recommender from './shortcutRecommender';
import { useShortcutTips } from './useShortcutTips';

const mockRecommendation: recommender.ShortcutRecommendation = {
  actionId: 'menu:group',
  shortcutId: 'group',
  shortcutLabel: 'Group selection',
  usageCount: 7,
  message: "You've used Group selection 7 times this week. Try Ctrl+G.",
};

const recommendSpy = vi.spyOn(recommender, 'recommendShortcuts');

vi.mock('../workspace/workspaceTypes', () => ({
  getWorkspaceConfig: vi.fn(() => ({
    shortcuts: { disabled: [] },
  })),
}));

describe('useShortcutTips', () => {
  beforeEach(() => {
    localStorage.clear();
    recommendSpy.mockReset();
    vi.useFakeTimers();
  });

  it('returns null when no recommendation is available', () => {
    recommendSpy.mockReturnValue([]);
    const { result } = renderHook(() => useShortcutTips('design', true));
    expect(result.current.currentTip).toBeNull();
  });

  it('returns a recommendation when available', () => {
    recommendSpy.mockReturnValue([mockRecommendation]);
    const { result } = renderHook(() => useShortcutTips('design', true));
    expect(result.current.currentTip).toEqual(mockRecommendation);
  });

  it('returns null when showTipsEnabled is false', () => {
    recommendSpy.mockReturnValue([mockRecommendation]);
    const { result } = renderHook(() => useShortcutTips('design', false));
    expect(result.current.currentTip).toBeNull();
  });

  it('dismisses the tip and persists the dismissal', () => {
    recommendSpy.mockReturnValue([mockRecommendation]);
    const { result } = renderHook(() => useShortcutTips('design', true));

    expect(result.current.currentTip).toBeTruthy();

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.currentTip).toBeNull();

    const dismissed = JSON.parse(localStorage.getItem('strata:dismissed-tips') ?? '[]');
    expect(dismissed).toContain('group');
  });

  it('does not show a dismissed tip after re-mount', () => {
    recommendSpy.mockReturnValue([mockRecommendation]);
    const { result: first } = renderHook(() => useShortcutTips('design', true));
    expect(first.current.currentTip).toBeTruthy();

    act(() => {
      first.current.dismiss();
    });

    recommendSpy.mockReturnValue([mockRecommendation]);
    const { result: second } = renderHook(() => useShortcutTips('design', true));
    expect(second.current.currentTip).toBeNull();
  });

  it('shows at most one tip per session', () => {
    recommendSpy.mockReturnValue([mockRecommendation]);

    const { result, rerender } = renderHook(() => useShortcutTips('design', true));
    expect(result.current.currentTip).toEqual(mockRecommendation);

    act(() => {
      result.current.dismiss();
    });

    recommendSpy.mockReturnValue([{ ...mockRecommendation, shortcutId: 'alignLeft' }]);

    rerender();
    expect(result.current.currentTip).toBeNull();
  });

  it('auto-dismisses the tip after 10 seconds', () => {
    recommendSpy.mockReturnValue([mockRecommendation]);
    const { result } = renderHook(() => useShortcutTips('design', true));

    expect(result.current.currentTip).toEqual(mockRecommendation);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.currentTip).toBeNull();
  });

  it('passes disabledShortcutIds to recommendShortcuts', () => {
    recommendSpy.mockReturnValue([]);
    renderHook(() => useShortcutTips('design', true));
    expect(recommendSpy).toHaveBeenCalledWith(expect.anything(), 1, []);
  });
});
