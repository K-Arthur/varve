/**
 * Production CSP regression — icon provider network access.
 *
 * The icon workflow must work identically in the browser and in packaged
 * Tauri builds. Tauri enforces `security.csp` from tauri.conf.json; if the
 * Iconify hosts are missing there, the feature silently works in dev
 * (devCsp / Vite dev server) but fails in the packaged app.
 *
 * This test guards the packaged-app config: allowed hosts present, no
 * wildcard connect-src, and the allowlist matches the client's host list.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ICONIFY_CSP_HOSTS, ICONIFY_HOSTS } from '@varve/engine';
import { describe, expect, it } from 'vitest';

interface TauriConfig {
  app?: { security?: { csp?: Record<string, string[]>; devCsp?: Record<string, string[]> } };
}

async function readTauriConfig(): Promise<TauriConfig> {
  const raw = await readFile(join(process.cwd(), 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8');
  return JSON.parse(raw) as TauriConfig;
}

describe('Tauri CSP allows the icon providers', () => {
  it('lists every Iconify host in production connect-src', async () => {
    const config = await readTauriConfig();
    const connectSrc = config.app?.security?.csp?.['connect-src'] ?? [];
    for (const host of ICONIFY_CSP_HOSTS) {
      expect(connectSrc).toContain(host);
    }
  });

  it('lists every Iconify host in dev connect-src', async () => {
    const config = await readTauriConfig();
    const connectSrc = config.app?.security?.devCsp?.['connect-src'] ?? [];
    for (const host of ICONIFY_CSP_HOSTS) {
      expect(connectSrc).toContain(host);
    }
  });

  it('does not use a broad wildcard for connect-src', async () => {
    const config = await readTauriConfig();
    const csp = config.app?.security?.csp;
    expect(csp).toBeDefined();
    const blocked = ['https:', 'http:', 'https://*', 'http://*', '*'];
    for (const wildcard of blocked) {
      expect(csp?.['connect-src']).not.toContain(wildcard);
    }
  });

  it('keeps script/frame/object sources locked down', async () => {
    const config = await readTauriConfig();
    const csp = config.app?.security?.csp;
    expect(csp?.['script-src']).toBeDefined();
    expect(csp?.['script-src']).not.toContain('https:');
    expect(csp?.['frame-src']).toEqual(["'none'"]);
    expect(csp?.['object-src']).toEqual(["'none'"]);
  });

  it('keeps the client host list in sync with the CSP allowlist', () => {
    expect(ICONIFY_CSP_HOSTS).toEqual([...ICONIFY_HOSTS]);
  });
});
