/**
 * Transfer state machine tests (ADR-0208).
 *
 * Tests the full lifecycle of panel transfer transactions including
 * happy paths, failures, rollback, and concurrent transfer prevention.
 */

import { describe, expect, it } from 'vitest';
import { TransferStateMachine, validateTransfer } from '../transferStateMachine';

function makeCapabilities(
  detachable = true,
  hosts: string[] = ['primary-sidebar', 'auxiliary-window'],
) {
  return { detachable, allowedHosts: hosts };
}

describe('transferStateMachine: happy path — detach', () => {
  it('completes a full detach transfer', () => {
    const sm = new TransferStateMachine();
    const tx = sm.start({
      direction: 'detach',
      panelInstanceId: 'pi-1',
      panelTypeId: 'layers',
      sourceWindowId: 'main',
      sourceNodeId: 'dn-source',
      targetWindowId: 'aux-1',
    });

    expect(tx.state).toBe('preparing-source');
    expect(sm.isTransferring('pi-1')).toBe(true);

    sm.advance(tx.id, 'creating-destination');
    sm.advance(tx.id, 'waiting-ready');
    sm.setSnapshot(tx.id, { schemaVersion: 1, panelTypeId: 'layers', state: {}, byteSize: 0 });
    sm.advance(tx.id, 'hydrating');
    sm.advance(tx.id, 'acknowledged');
    sm.advance(tx.id, 'committing');
    sm.advance(tx.id, 'removing-source');

    const completed = sm.complete(tx.id);
    expect(completed.state).toBe('idle');
    expect(sm.isTransferring('pi-1')).toBe(false);
  });
});

describe('transferStateMachine: happy path — reattach', () => {
  it('completes a full reattach transfer', () => {
    const sm = new TransferStateMachine();
    const tx = sm.start({
      direction: 'reattach',
      panelInstanceId: 'pi-2',
      panelTypeId: 'inspector',
      sourceWindowId: 'aux-1',
      sourceNodeId: 'dn-source',
      targetWindowId: 'main',
    });

    sm.advance(tx.id, 'creating-destination');
    sm.advance(tx.id, 'waiting-ready');
    sm.setSnapshot(tx.id, { schemaVersion: 1, panelTypeId: 'inspector', state: {}, byteSize: 0 });
    sm.advance(tx.id, 'hydrating');
    sm.advance(tx.id, 'acknowledged');
    sm.advance(tx.id, 'committing');
    sm.advance(tx.id, 'removing-source');
    const completed = sm.complete(tx.id);
    expect(completed.state).toBe('idle');
  });
});

describe('transferStateMachine: failure and rollback', () => {
  it('fails from preparing-source', () => {
    const sm = new TransferStateMachine();
    const tx = sm.start({
      direction: 'detach',
      panelInstanceId: 'pi-1',
      panelTypeId: 'layers',
      sourceWindowId: 'main',
      sourceNodeId: 'dn-source',
      targetWindowId: 'aux-1',
    });

    const failed = sm.fail(tx.id, 'panel blocked transfer');
    expect(failed.state).toBe('failed');
    expect(failed.error).toBe('panel blocked transfer');

    // Can reset to idle after failure
    const reset = sm.advance(tx.id, 'idle');
    expect(reset.state).toBe('idle');
    expect(sm.isTransferring('pi-1')).toBe(false);
  });

  it('fails from waiting-ready (destination never ready)', () => {
    const sm = new TransferStateMachine();
    const tx = sm.start({
      direction: 'detach',
      panelInstanceId: 'pi-1',
      panelTypeId: 'layers',
      sourceWindowId: 'main',
      sourceNodeId: 'dn-source',
      targetWindowId: 'aux-1',
    });

    sm.advance(tx.id, 'creating-destination');
    sm.advance(tx.id, 'waiting-ready');
    const failed = sm.fail(tx.id, 'timeout: destination not ready');
    expect(failed.state).toBe('failed');
  });

  it('fails from committing (layout write failed)', () => {
    const sm = new TransferStateMachine();
    const tx = sm.start({
      direction: 'detach',
      panelInstanceId: 'pi-1',
      panelTypeId: 'layers',
      sourceWindowId: 'main',
      sourceNodeId: 'dn-source',
      targetWindowId: 'aux-1',
    });

    sm.advance(tx.id, 'creating-destination');
    sm.advance(tx.id, 'waiting-ready');
    sm.setSnapshot(tx.id, {});
    sm.advance(tx.id, 'hydrating');
    sm.advance(tx.id, 'acknowledged');
    sm.advance(tx.id, 'committing');
    const failed = sm.fail(tx.id, 'layout write failed');
    expect(failed.state).toBe('failed');
  });
});

describe('transferStateMachine: invalid transitions', () => {
  it('throws on invalid transition', () => {
    const sm = new TransferStateMachine();
    const tx = sm.start({
      direction: 'detach',
      panelInstanceId: 'pi-1',
      panelTypeId: 'layers',
      sourceWindowId: 'main',
      sourceNodeId: 'dn-source',
      targetWindowId: 'aux-1',
    });

    expect(() => sm.advance(tx.id, 'acknowledged')).toThrow(/invalid transition/);
  });

  it('throws on unknown transaction', () => {
    const sm = new TransferStateMachine();
    expect(() => sm.advance('nonexistent', 'idle')).toThrow(/unknown transaction/);
  });

  it('throws on double-start for same panel', () => {
    const sm = new TransferStateMachine();
    sm.start({
      direction: 'detach',
      panelInstanceId: 'pi-1',
      panelTypeId: 'layers',
      sourceWindowId: 'main',
      sourceNodeId: 'dn-source',
      targetWindowId: 'aux-1',
    });

    expect(() =>
      sm.start({
        direction: 'detach',
        panelInstanceId: 'pi-1',
        panelTypeId: 'layers',
        sourceWindowId: 'main',
        sourceNodeId: 'dn-source',
        targetWindowId: 'aux-2',
      }),
    ).toThrow(/already has an active transfer/);
  });
});

describe('transferStateMachine: queries', () => {
  it('getActiveForPanel returns the active transfer', () => {
    const sm = new TransferStateMachine();
    const tx = sm.start({
      direction: 'detach',
      panelInstanceId: 'pi-1',
      panelTypeId: 'layers',
      sourceWindowId: 'main',
      sourceNodeId: 'dn-source',
      targetWindowId: 'aux-1',
    });

    expect(sm.getActiveForPanel('pi-1')?.id).toBe(tx.id);
    expect(sm.getActiveForPanel('pi-2')).toBeUndefined();
  });

  it('isTransferring is false after completion', () => {
    const sm = new TransferStateMachine();
    const tx = sm.start({
      direction: 'detach',
      panelInstanceId: 'pi-1',
      panelTypeId: 'layers',
      sourceWindowId: 'main',
      sourceNodeId: 'dn-source',
      targetWindowId: 'aux-1',
    });
    // Advance through full lifecycle
    sm.advance(tx.id, 'creating-destination');
    sm.advance(tx.id, 'waiting-ready');
    sm.setSnapshot(tx.id, {});
    sm.advance(tx.id, 'hydrating');
    sm.advance(tx.id, 'acknowledged');
    sm.advance(tx.id, 'committing');
    sm.advance(tx.id, 'removing-source');
    sm.complete(tx.id);
    expect(sm.isTransferring('pi-1')).toBe(false);
  });
});

describe('transferStateMachine: validateTransfer', () => {
  it('rejects non-detachable panels', () => {
    const err = validateTransfer(
      'pi-1',
      'detach',
      new Map(),
      makeCapabilities(false),
      'auxiliary-window',
    );
    expect(err).toBe('panel is not detachable');
  });

  it('rejects unsupported host kind', () => {
    const err = validateTransfer(
      'pi-1',
      'detach',
      new Map(),
      makeCapabilities(true, ['primary-sidebar']),
      'dialog',
    );
    expect(err).toBe("panel cannot host in 'dialog'");
  });

  it('rejects panels with active transfers', () => {
    const sm = new TransferStateMachine();
    const tx = sm.start({
      direction: 'detach',
      panelInstanceId: 'pi-1',
      panelTypeId: 'layers',
      sourceWindowId: 'main',
      sourceNodeId: 'dn-source',
      targetWindowId: 'aux-1',
    });
    const active = new Map([['tx-1', tx]]);
    const err = validateTransfer('pi-1', 'detach', active, makeCapabilities(), 'auxiliary-window');
    expect(err).toContain('already has an active transfer');
  });

  it('allows valid transfers', () => {
    const err = validateTransfer(
      'pi-1',
      'detach',
      new Map(),
      makeCapabilities(),
      'auxiliary-window',
    );
    expect(err).toBeNull();
  });
});
