import { afterEach, describe, expect, it } from 'vitest';
import { suppressFirstRunOnboarding } from './demoOnboarding';

describe('suppressFirstRunOnboarding', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('marks the first-run overlay dismissed so demo visitors see the sample immediately', () => {
    expect(localStorage.getItem('varve:first-run-overlay:dismissed')).toBeNull();
    suppressFirstRunOnboarding();
    expect(localStorage.getItem('varve:first-run-overlay:dismissed')).toBe('true');
  });
});
