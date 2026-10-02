import { describe, expect, it } from 'vitest';
import config from '../../playwright.config';

describe('browser validation action budgets', () => {
  it('bounds ordinary actions below the test deadline in every app project', () => {
    const timeout = config.timeout ?? 30000;
    for (const project of config.projects ?? []) {
      const use = { ...config.use, ...project.use };
      expect(use.actionTimeout, `${project.name} must bound missing controls`).toBeGreaterThan(0);
      expect(use.actionTimeout).toBeLessThan(timeout);
      expect(use.actionTimeout).toBeLessThanOrEqual(45000);
    }
  });

  it('keeps cold startup and assertion budgets independent of action waits', () => {
    expect(config.timeout).toBeGreaterThanOrEqual(180000);
    expect(config.expect?.timeout).toBeLessThan(config.use?.actionTimeout ?? 0);
    expect(config.webServer).toMatchObject({ reuseExistingServer: false, timeout: 120000 });
    expect(config.updateSnapshots).toBe('none');
  });
});
