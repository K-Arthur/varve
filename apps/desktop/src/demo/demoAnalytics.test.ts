// @vitest-environment jsdom

import { configureDesktopAnalytics, resetDesktopAnalyticsForTests } from '@varve/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readDemoAnalyticsChoice,
  setDemoAnalyticsChoice,
  trackDemoLaunched,
} from './demoAnalytics';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDesktopAnalyticsForTests();
});

afterEach(() => {
  resetDesktopAnalyticsForTests();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('browser demo analytics', () => {
  it('sends nothing while usage consent is unknown', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    configureDesktopAnalytics({ domain: 'varve.studio' });

    expect(readDemoAnalyticsChoice()).toBe('unknown');
    await trackDemoLaunched();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('varve-demo-launch-counted')).toBeNull();
  });

  it('flushes one direct launch after an explicit grant', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    configureDesktopAnalytics({ domain: 'varve.studio' });

    await setDemoAnalyticsChoice('granted');

    expect(readDemoAnalyticsChoice()).toBe('granted');
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      name: string;
      props: Record<string, string>;
    };
    expect(body.name).toBe('browser_demo_launched');
    expect(body.props).toMatchObject({ entry: 'direct' });
    expect(Object.keys(body.props)).toEqual(
      expect.arrayContaining(['entry', 'app_version', 'platform', 'release_channel']),
    );
    expect(body.props).not.toHaveProperty('filename');
    expect(body.props).not.toHaveProperty('path');
  });
});
