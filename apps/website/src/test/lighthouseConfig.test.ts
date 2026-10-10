import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const configPath = path.resolve(__dirname, '../../lighthouserc.cjs');

function loadConfig() {
  delete require.cache[configPath];
  return require(configPath) as {
    ci: {
      collect: {
        url: string[];
        staticDistDir?: string;
        settings?: { chromeFlags?: string };
      };
      assert?: {
        assertions: Record<string, [string, { minScore?: number; maxNumericValue?: number }]>;
        budgets?: unknown[];
      };
    };
  };
}

describe('website Lighthouse CI config', () => {
  it('audits the required pages against static dist by default', () => {
    const previous = {
      LHCI_BASE_URL: process.env.LHCI_BASE_URL,
      LHCI_FORM_FACTOR: process.env.LHCI_FORM_FACTOR,
      LHCI_REPORT_ONLY: process.env.LHCI_REPORT_ONLY,
    };
    delete process.env.LHCI_BASE_URL;
    delete process.env.LHCI_FORM_FACTOR;
    delete process.env.LHCI_REPORT_ONLY;
    try {
      const config = loadConfig();
      expect(config.ci.collect.url).toEqual([
        'http://127.0.0.1/',
        'http://127.0.0.1/download/',
        'http://127.0.0.1/features/generative-editing/',
        'http://127.0.0.1/docs/',
        'http://127.0.0.1/compare/',
      ]);
      expect(config.ci.collect.staticDistDir).toContain(
        `${path.sep}apps${path.sep}website${path.sep}dist`,
      );
      expect(config.ci.assert?.assertions['categories:performance']).toEqual([
        'error',
        { minScore: 0.88 },
      ]);
      expect(config.ci.assert?.budgets).toHaveLength(1);
      expect(config.ci.collect.settings?.chromeFlags).toContain('--no-sandbox');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('retargets at LHCI_BASE_URL and raises desktop floors', () => {
    const previous = {
      LHCI_BASE_URL: process.env.LHCI_BASE_URL,
      LHCI_FORM_FACTOR: process.env.LHCI_FORM_FACTOR,
    };
    process.env.LHCI_BASE_URL = 'https://varve.studio';
    process.env.LHCI_FORM_FACTOR = 'desktop';
    try {
      const config = loadConfig();
      expect(config.ci.collect.staticDistDir).toBeUndefined();
      expect(config.ci.collect.url[0]).toBe('https://varve.studio/');
      expect(config.ci.assert?.assertions['categories:performance'][1].minScore).toBe(0.95);
      expect(config.ci.assert?.assertions['largest-contentful-paint'][1].maxNumericValue).toBe(900);
      expect(config.ci.assert?.assertions['total-blocking-time'][1].maxNumericValue).toBe(50);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
