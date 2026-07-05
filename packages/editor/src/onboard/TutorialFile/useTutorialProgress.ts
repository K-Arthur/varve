import type { Document } from '@strata/scene';
import { useCallback, useMemo, useState } from 'react';
import { TUTORIAL_DOCUMENT_ID } from '../../samples/tutorial-document';
import { checkChecklistItem, loadOnboardingState, saveOnboardingState } from '../onboardingStore';

function lessonCheckpointId(frameId: string): string {
  return `tutorial:lesson-${frameId}`;
}

export interface TutorialProgress {
  currentLesson: number;
  totalLessons: number;
  completedLessons: Set<string>;
  markLessonComplete: (frameId: string) => void;
  isTutorialDoc: boolean;
  progressPercent: number;
}

export function useTutorialProgress(doc: Document): TutorialProgress {
  const isTutorialDoc = (doc as unknown as Record<string, unknown>).id === TUTORIAL_DOCUMENT_ID;

  const frameIds = useMemo(() => {
    if (!isTutorialDoc) return [];
    return doc.rootChildren
      .map((id) => doc.nodes[id])
      .filter((n) => n?.kind === 'frame')
      .map((n) => n.id);
  }, [doc, isTutorialDoc]);

  const totalLessons = frameIds.length;

  const [completedLessons, setCompletedLessons] = useState<Set<string>>(() => {
    if (!isTutorialDoc) return new Set();
    const state = loadOnboardingState();
    const completed = new Set<string>();
    for (const fid of frameIds) {
      if (state.checklistProgress.includes(lessonCheckpointId(fid))) {
        completed.add(fid);
      }
    }
    return completed;
  });

  const markLessonComplete = useCallback((frameId: string) => {
    setCompletedLessons((prev) => {
      if (prev.has(frameId)) return prev;
      const next = new Set(prev);
      next.add(frameId);
      const state = loadOnboardingState();
      const updated = checkChecklistItem(state, lessonCheckpointId(frameId));
      saveOnboardingState(updated);
      return next;
    });
  }, []);

  const progressPercent = useMemo(() => {
    if (totalLessons === 0) return 0;
    return Math.round((completedLessons.size / totalLessons) * 100);
  }, [completedLessons.size, totalLessons]);

  const firstIncompleteIndex = useMemo(() => {
    for (let i = 0; i < frameIds.length; i++) {
      if (!completedLessons.has(frameIds[i]!)) return i;
    }
    return frameIds.length; // all complete
  }, [frameIds, completedLessons]);

  return {
    currentLesson: isTutorialDoc ? firstIncompleteIndex + 1 : 0,
    totalLessons,
    completedLessons,
    markLessonComplete,
    isTutorialDoc,
    progressPercent,
  };
}
