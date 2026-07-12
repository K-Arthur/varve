export interface StartupMark {
  name: string;
  time: number;
}

export interface StartupTimer {
  mark(name: string): void;
  getMarks(): readonly StartupMark[];
  elapsed(): number;
}

export function createStartupTimer(): StartupTimer {
  const marks: StartupMark[] = [];

  return {
    mark(name: string): void {
      marks.push({ name, time: performance.now() });
      // Also register a native User Timing mark so consumers (e.g. `performance.measure`,
      // browser devtools) can reference it by name.
      performance.mark(name);
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
  };
}
