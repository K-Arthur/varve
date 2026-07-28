import { describe, expect, it } from 'vitest';
import type { IconAttributionEntry } from './iconLicence';
import {
  canUseCommercially,
  generateAttributionReport,
  ICON_LICENCES,
  parseIconLicence,
} from './iconLicence';

describe('parseIconLicence', () => {
  it('parses MIT licence', () => {
    expect(parseIconLicence('MIT').spdxId).toBe('mit');
    expect(parseIconLicence('MIT').commercialUse).toBe(true);
  });
  it('parses Apache 2.0', () => {
    expect(parseIconLicence('Apache License 2.0').spdxId).toBe('apache-2.0');
  });
  it('parses CC BY-SA', () => {
    expect(parseIconLicence('CC BY-SA 4.0').spdxId).toBe('cc-by-sa-4.0');
  });
  it('parses CC BY-NC', () => {
    const result = parseIconLicence('CC BY-NC 4.0');
    expect(result.spdxId).toBe('cc-by-nc-4.0');
    expect(result.commercialUse).toBe(false);
  });
  it('returns unknown for empty input', () => {
    expect(parseIconLicence(undefined).spdxId).toBe('unknown');
  });
});

describe('canUseCommercially', () => {
  it('allows all permissive icons', () => {
    const icons: IconAttributionEntry[] = [
      { iconName: 'a', provider: 'mdi', licence: ICON_LICENCES.mit },
    ];
    expect(canUseCommercially(icons).allowed).toBe(true);
  });
  it('blocks non-commercial icons', () => {
    const icons: IconAttributionEntry[] = [
      { iconName: 'a', provider: 'mdi', licence: ICON_LICENCES.mit },
      { iconName: 'b', provider: 'custom', licence: ICON_LICENCES['cc-by-nc-4.0'] },
    ];
    expect(canUseCommercially(icons).allowed).toBe(false);
    expect(canUseCommercially(icons).blocked).toHaveLength(1);
  });
});

describe('generateAttributionReport', () => {
  it('generates a report grouped by licence', () => {
    const icons: IconAttributionEntry[] = [
      { iconName: 'home', provider: 'mdi', licence: ICON_LICENCES.mit },
    ];
    const report = generateAttributionReport(icons);
    expect(report).toContain('MIT License');
    expect(report).toContain('"home"');
  });
});
