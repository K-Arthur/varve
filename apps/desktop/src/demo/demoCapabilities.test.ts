import { getCapabilityRestrictions, setCapabilityRestrictions } from '@varve/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDemoCapabilities, DEMO_WORKSPACE_MODES } from './demoCapabilities';
import type { DemoConfig } from './demoMode';

const config = (active: boolean): DemoConfig => ({
  active,
  downloadUrl: 'https://varve.studio/download',
  label: active ? 'demo' : 'standard',
});

afterEach(() => setCapabilityRestrictions(null));

describe('demo capabilities', () => {
  it('leaves a non-demo page load completely unrestricted', () => {
    applyDemoCapabilities(config(false));
    const restrictions = getCapabilityRestrictions();
    expect(restrictions.restricted.size).toBe(0);
    expect(restrictions.workspaceModes).toBeNull();
  });

  it('withholds inference and print production in the demo', () => {
    applyDemoCapabilities(config(true));
    const restrictions = getCapabilityRestrictions();
    expect([...restrictions.restricted].sort()).toEqual(['inference', 'printProduction']);
  });

  it('exposes only the three primary workspaces', () => {
    applyDemoCapabilities(config(true));
    expect(getCapabilityRestrictions().workspaceModes).toEqual(['design', 'drawing', 'image']);
    // The broken and the performance-hostile ones must not slip back in.
    for (const withheld of ['print', 'motion', 'codegen', 'logo', 'email']) {
      expect(DEMO_WORKSPACE_MODES).not.toContain(withheld);
    }
  });

  it('carries the download URL through as the upgrade target', () => {
    applyDemoCapabilities(config(true));
    expect(getCapabilityRestrictions().upgradeUrl).toBe('https://varve.studio/download');
  });
});
