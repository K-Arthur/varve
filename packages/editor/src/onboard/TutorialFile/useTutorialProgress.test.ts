/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createTutorialDocument } from '../../samples/tutorial-document';
import { useTutorialProgress } from './useTutorialProgress';
import { loadOnboardingState, saveOnboardingState } from '../onboardingStore';

describe('useTutorialProgress', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('detects tutorial document by id', () => {
    const doc = createTutorialDocument();
    const { result } = renderHook(() => useTutorialProgress(doc));
    expect(result.current.isTutorialDoc).toBe(true);
  });

  it('all lessons incomplete initially', () => {
    const doc = createTutorialDocument();
    const { result } = renderHook(() => useTutorialProgress(doc));
    expect(result.current.currentLesson).toBe(1);
    expect(result.current.totalLessons).toBe(3);
    expect(result.current.completedLessons.size).toBe(0);
    expect(result.current.progressPercent).toBe(0);
  });

  it('markLessonComplete adds to completed set', () => {
    const doc = createTutorialDocument();
    const frameId = doc.rootChildren[0]!;
    const { result } = renderHook(() => useTutorialProgress(doc));
    act(() => {
      result.current.markLessonComplete(frameId);
    });
    expect(result.current.completedLessons.has(frameId)).toBe(true);
  });

  it('progress percent calculated correctly (33%, 66%, 100%)', () => {
    const doc = createTutorialDocument();
    const { result } = renderHook(() => useTutorialProgress(doc));

    // 1 of 3 = 33%
    act(() => {
      result.current.markLessonComplete(doc.rootChildren[0]!);
    });
    expect(result.current.progressPercent).toBe(33);

    // 2 of 3 = 66%
    act(() => {
      result.current.markLessonComplete(doc.rootChildren[1]!);
    });
    expect(result.current.progressPercent).toBe(66);

    // 3 of 3 = 100%
    act(() => {
      result.current.markLessonComplete(doc.rootChildren[2]!);
    });
    expect(result.current.progressPercent).toBe(100);
  });

  it('progress persists across sessions (mocked localStorage)', () => {
    // First session: complete lesson 1
    const doc = createTutorialDocument();
    const { result, unmount } = renderHook(() => useTutorialProgress(doc));
    act(() => {
      result.current.markLessonComplete(doc.rootChildren[0]!);
    });
    expect(result.current.progressPercent).toBe(33);
    expect(result.current.completedLessons.has(doc.rootChildren[0]!)).toBe(true);
    unmount();

    // Second session: should still show 33%
    const { result: result2 } = renderHook(() => useTutorialProgress(doc));
    expect(result2.current.completedLessons.has(doc.rootChildren[0]!)).toBe(true);
    expect(result2.current.progressPercent).toBe(33);
  });

  it('non-tutorial document returns isTutorialDoc: false', () => {
    const nonTutorial = {
      ...createTutorialDocument(),
      id: 'some-other-id',
    };
    const { result } = renderHook(() => useTutorialProgress(nonTutorial));
    expect(result.current.isTutorialDoc).toBe(false);
    expect(result.current.progressPercent).toBe(0);
    expect(result.current.totalLessons).toBe(0);
  });
});
