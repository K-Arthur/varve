/**
 * Auxiliary shell tests (M6).
 *
 * Tests URL parameter parsing, minimal rendering, and session provider
 * integration for panel-only auxiliary windows.
 */

import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AuxiliaryRoot, parseAuxiliaryWindowParams } from '../../auxiliary/AuxiliaryShell';

describe('auxiliary: URL parameter parsing', () => {
  it('parses valid panel-window params', () => {
    const result = parseAuxiliaryWindowParams(
      '?surface=panel-window&windowId=aux-1&session=sess-123&panels=layers&transaction=detach-123&panelInstanceId=layers-primary',
    );
    expect(result).toEqual({
      windowId: 'aux-1',
      sessionId: 'sess-123',
      panelTypeIds: ['layers'],
      transactionId: 'detach-123',
      panelInstanceId: 'layers-primary',
    });
  });

  it('returns null for non-panel-window surface', () => {
    expect(parseAuxiliaryWindowParams('?surface=editor')).toBeNull();
  });

  it('returns null when windowId is missing', () => {
    expect(
      parseAuxiliaryWindowParams(
        '?surface=panel-window&session=s1&panels=layers&transaction=tx&panelInstanceId=layers-primary',
      ),
    ).toBeNull();
  });

  it('returns null when session is missing', () => {
    expect(
      parseAuxiliaryWindowParams(
        '?surface=panel-window&windowId=w1&panels=layers&transaction=tx&panelInstanceId=layers-primary',
      ),
    ).toBeNull();
  });

  it('returns null for empty params', () => {
    expect(parseAuxiliaryWindowParams('')).toBeNull();
  });

  it('rejects a route without a reserved transactional host identity', () => {
    expect(
      parseAuxiliaryWindowParams('?surface=panel-window&windowId=w1&session=s1&panels=layers'),
    ).toBeNull();
  });

  it('rejects grouped, unknown, or invalid-generation panel routes', () => {
    expect(
      parseAuxiliaryWindowParams(
        '?surface=panel-window&windowId=w1&session=s1&panels=layers,inspector&transaction=tx&panelInstanceId=layers-primary',
      ),
    ).toBeNull();
    expect(
      parseAuxiliaryWindowParams(
        '?surface=panel-window&windowId=w1&session=s1&panels=timeline&transaction=tx&panelInstanceId=timeline-primary',
      ),
    ).toBeNull();
    expect(
      parseAuxiliaryWindowParams(
        '?surface=panel-window&windowId=w1&session=s1&panels=layers&transaction=tx&panelInstanceId=layers-primary&generation=zero',
      ),
    ).toBeNull();
  });

  it('keeps the reserved transaction identity required for hydration', () => {
    const result = parseAuxiliaryWindowParams(
      '?surface=panel-window&windowId=panel_layers_1&session=session_1&panels=layers&transaction=detach_1&panelInstanceId=layers_primary&generation=2',
    );
    expect(result).toMatchObject({
      windowId: 'panel_layers_1',
      sessionId: 'session_1',
      panelTypeIds: ['layers'],
      transactionId: 'detach_1',
      panelInstanceId: 'layers_primary',
      generation: 2,
    });
  });

  it('fails closed without creating an auxiliary session for an invalid route', () => {
    render(createElement(AuxiliaryRoot));
    expect(screen.getByRole('main', { name: 'Panel window unavailable' })).toBeVisible();
  });
});
