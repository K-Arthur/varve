export interface StartupMark {
  name: string;
  /** Monotonic, navigation-relative timestamp from `performance.now()`. */
  time: number;
}

export interface StartupTimelineExport {
  schemaVersion: 1;
  clock: 'performance-now';
  /** Epoch timestamp corresponding to zero on the monotonic clock, when available. */
  timeOrigin: number | null;
  marks: readonly StartupMark[];
}

export interface StartupTimer {
  mark(name: string): void;
  /** Records a lifecycle milestone at most once (important under React StrictMode). */
  markOnce(name: string): boolean;
  getMarks(): readonly StartupMark[];
  elapsed(): number;
  exportTimeline(): StartupTimelineExport;
}

export const STARTUP_MILESTONES = {
  APP_MOUNT: 'app_mount',
  HOME_DATA_READY: 'home_data_ready',
  HOME_INTERACTIVE: 'home_interactive',
  EDITOR_STATE_INITIALIZED: 'editor_state_initialized',
  EDITOR_FIRST_VISIBLE_CANVAS: 'editor_first_visible_canvas',
} as const;

export type StartupMilestone = (typeof STARTUP_MILESTONES)[keyof typeof STARTUP_MILESTONES];

export function createStartupTimer(
  now: () => number = () => performance.now(),
  markUserTiming: (name: string) => void = (name) => performance.mark(name),
): StartupTimer {
  const marks: StartupMark[] = [];
  const names = new Set<string>();

  const addMark = (name: string): void => {
    const previous = marks.at(-1)?.time ?? 0;
    // performance.now() is monotonic by contract. Clamp custom/test clocks as a
    // defensive measure so exported traces always satisfy the same invariant.
    const time = Math.max(previous, now());
    marks.push(Object.freeze({ name, time }));
    names.add(name);
    try {
      markUserTiming(name);
    } catch {
      // User Timing can be unavailable or disabled without losing diagnostics.
    }
  };

  return {
    mark(name: string): void {
      addMark(name);
    },

    markOnce(name: string): boolean {
      if (names.has(name)) return false;
      addMark(name);
      return true;
    },

    getMarks(): readonly StartupMark[] {
      return Object.freeze([...marks]);
    },

    elapsed(): number {
      if (marks.length === 0) return 0;
      const first = marks[0];
      const last = marks[marks.length - 1];
      if (!first || !last) return 0;
      return last.time - first.time;
    },

    exportTimeline(): StartupTimelineExport {
      const timeOrigin =
        typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)
          ? performance.timeOrigin
          : null;
      return Object.freeze({
        schemaVersion: 1,
        clock: 'performance-now',
        timeOrigin,
        marks: Object.freeze([...marks]),
      });
    },
  };
}
