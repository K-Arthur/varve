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
    },

    getMarks(): readonly StartupMark[] {
      return Object.freeze([...marks]);
    },

    elapsed(): number {
      if (marks.length === 0) return 0;
      return marks[marks.length - 1].time - marks[0].time;
    },
  };
}
