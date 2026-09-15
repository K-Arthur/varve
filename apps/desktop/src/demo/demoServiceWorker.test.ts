import { describe, expect, it } from 'vitest';
import {
  demoServiceWorkerUrl,
  normalizeDemoBaseUrl,
  shouldInstallDemoServiceWorker,
} from './demoServiceWorker';

describe('demo service-worker route', () => {
  it('normalizes the demo base without escaping its scope', () => {
    expect(normalizeDemoBaseUrl('/try/')).toBe('/try/');
    expect(normalizeDemoBaseUrl('/try')).toBe('/try/');
    expect(normalizeDemoBaseUrl('/')).toBe('/');
    expect(demoServiceWorkerUrl('/try/')).toBe('/try/varve-demo-sw.js');
  });

  it('only enables the worker for the production demo route', () => {
    expect(shouldInstallDemoServiceWorker({ active: true, development: false })).toBe(true);
    expect(shouldInstallDemoServiceWorker({ active: false, development: false })).toBe(false);
    expect(shouldInstallDemoServiceWorker({ active: true, development: true })).toBe(false);
  });
});
