export const MENU_PERF_INSTRUMENTATION = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

let _menuPerfEnabled = MENU_PERF_INSTRUMENTATION;

export function setMenuPerfInstrumentation(enabled: boolean): void {
  _menuPerfEnabled = enabled;
}

export function isMenuPerfInstrumentationEnabled(): boolean {
  return _menuPerfEnabled;
}

const isPerfAvailable = typeof performance !== 'undefined' && typeof performance.mark === 'function';

export function menuPerfMark(name: string): void {
  if (!_menuPerfEnabled || !isPerfAvailable) return;
  performance.mark(name);
}

export function menuPerfMeasure(name: string, startMark: string, endMark: string): void {
  if (!_menuPerfEnabled || !isPerfAvailable) return;
  performance.measure(name, startMark, endMark);
}

export function menuPerfClear(name: string): void {
  if (!_menuPerfEnabled || !isPerfAvailable) return;
  performance.clearMarks(name);
  performance.clearMeasures(name);
}

export function timeMenuOperation<T>(label: string, fn: () => T): T {
  if (!_menuPerfEnabled || !isPerfAvailable) return fn();
  const start = `menu:${label}:start`;
  const end = `menu:${label}:end`;
  performance.mark(start);
  const result = fn();
  performance.mark(end);
  performance.measure(`menu:${label}`, start, end);
  performance.clearMarks(start);
  performance.clearMarks(end);
  performance.clearMeasures(`menu:${label}`);
  return result;
}

export async function timeMenuOperationAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!_menuPerfEnabled || !isPerfAvailable) return fn();
  const start = `menu:${label}:start`;
  const end = `menu:${label}:end`;
  performance.mark(start);
  const result = await fn();
  performance.mark(end);
  performance.measure(`menu:${label}`, start, end);
  performance.clearMarks(start);
  performance.clearMarks(end);
  performance.clearMeasures(`menu:${label}`);
  return result;
}

export function getMenuPerfMeasurements(): PerformanceMeasure[] {
  if (!isPerfAvailable) return [];
  return performance.getEntriesByType('measure') as PerformanceMeasure[];
}

export function clearMenuPerfMeasurements(): void {
  if (!isPerfAvailable) return;
  const measures = performance.getEntriesByType('measure');
  for (const m of measures) {
    if (m.name.startsWith('menu:')) {
      performance.clearMeasures(m.name);
    }
  }
  const marks = performance.getEntriesByType('mark');
  for (const m of marks) {
    if (m.name.startsWith('menu:')) {
      performance.clearMarks(m.name);
    }
  }
}
