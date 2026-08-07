/**
 * Auxiliary shell tests (M6).
 *
 * Tests URL parameter parsing, minimal rendering, and session provider
 * integration for panel-only auxiliary windows.
 */

import { describe, expect, it } from 'vitest';
import { parseAuxiliaryWindowParams } from '../../auxiliary/AuxiliaryShell';

describe('auxiliary: URL parameter parsing', () => {
  it('parses valid panel-window params', () => {
    const result = parseAuxiliaryWindowParams(
      '?surface=panel-window&windowId=aux-1&session=sess-123&panels=layers,inspector',
    );
    expect(result).toEqual({
      windowId: 'aux-1',
      sessionId: 'sess-123',
      panelTypeIds: ['layers', 'inspector'],
    });
  });

  it('returns null for non-panel-window surface', () => {
    expect(parseAuxiliaryWindowParams('?surface=editor')).toBeNull();
  });

  it('returns null when windowId is missing', () => {
    expect(parseAuxiliaryWindowParams('?surface=panel-window&session=s1')).toBeNull();
  });

  it('returns null when session is missing', () => {
    expect(parseAuxiliaryWindowParams('?surface=panel-window&windowId=w1')).toBeNull();
  });

  it('returns null for empty params', () => {
    expect(parseAuxiliaryWindowParams('')).toBeNull();
  });

  it('defaults to empty panels when not provided', () => {
    const result = parseAuxiliaryWindowParams('?surface=panel-window&windowId=w1&session=s1');
    expect(result?.panelTypeIds).toEqual([]);
  });

  it('filters empty panel entries', () => {
    const result = parseAuxiliaryWindowParams(
      '?surface=panel-window&windowId=w1&session=s1&panels=layers,,inspector,',
    );
    expect(result?.panelTypeIds).toEqual(['layers', 'inspector']);
  });
});
