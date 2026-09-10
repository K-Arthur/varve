import { afterEach, describe, expect, it } from 'vitest';
import {
  allowedWorkspaceModes,
  getCapabilityRestrictions,
  isCapabilityRestricted,
  isExportFormatRestricted,
  isWorkspaceModeAllowed,
  setCapabilityRestrictions,
} from './restrictions';

afterEach(() => setCapabilityRestrictions(null));

describe('capability restrictions', () => {
  it('restricts nothing by default, so desktop and web builds are untouched', () => {
    expect(isCapabilityRestricted('inference')).toBe(false);
    expect(isCapabilityRestricted('printProduction')).toBe(false);
    expect(isWorkspaceModeAllowed('print')).toBe(true);
    expect(isExportFormatRestricted('pdf-x4')).toBe(false);
    expect(getCapabilityRestrictions().workspaceModes).toBeNull();
  });

  it('reports the capabilities a deployment withholds', () => {
    setCapabilityRestrictions({
      restricted: new Set(['inference']),
      workspaceModes: null,
    });
    expect(isCapabilityRestricted('inference')).toBe(true);
    // Withholding one capability must not withhold the others.
    expect(isCapabilityRestricted('printProduction')).toBe(false);
  });

  it('restricts only the print-production export formats', () => {
    setCapabilityRestrictions({
      restricted: new Set(['printProduction']),
      workspaceModes: null,
    });
    for (const format of ['pdf-screen', 'pdf-x1a', 'pdf-x4']) {
      expect(isExportFormatRestricted(format)).toBe(true);
    }
    // A visitor must still be able to take their work out.
    for (const format of ['png', 'jpg', 'webp', 'svg']) {
      expect(isExportFormatRestricted(format)).toBe(false);
    }
  });

  it('filters workspace modes while preserving the caller order', () => {
    setCapabilityRestrictions({
      restricted: new Set(),
      workspaceModes: ['design', 'drawing', 'image'],
    });
    expect(allowedWorkspaceModes(['design', 'drawing', 'image', 'print', 'motion'])).toEqual([
      'design',
      'drawing',
      'image',
    ]);
    expect(isWorkspaceModeAllowed('design')).toBe(true);
    expect(isWorkspaceModeAllowed('print')).toBe(false);
  });

  it('passes the list through untouched when no workspace list is declared', () => {
    const modes = ['design', 'print'] as const;
    expect(allowedWorkspaceModes(modes)).toEqual(modes);
  });

  it('restores the unrestricted default when reset', () => {
    setCapabilityRestrictions({
      restricted: new Set(['inference', 'printProduction']),
      workspaceModes: ['design'],
    });
    setCapabilityRestrictions(null);
    expect(isCapabilityRestricted('inference')).toBe(false);
    expect(isWorkspaceModeAllowed('motion')).toBe(true);
  });
});
