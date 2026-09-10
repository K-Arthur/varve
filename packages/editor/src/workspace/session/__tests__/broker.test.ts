/**
 * Session protocol + broker tests (ADR-0023/0024/0025, ADR-0042 L1).
 *
 * Covers: envelope validation (version/session/id/payload bounds),
 * registration, generations, heartbeat liveness, snapshots, patch
 * fan-out + coalescing, command submission/ack/reject, duplicate and
 * stale command rejection, sequence gap handling, resync, unregistration,
 * and window-limit enforcement.
 */

import { describe, expect, it, vi } from 'vitest';
import { type BrokerCommandResult, SessionBroker } from '../broker';
import {
  createEnvelope,
  MAX_ENVELOPE_PAYLOAD_BYTES,
  SESSION_PROTOCOL_VERSION,
  type SessionEnvelope,
  validateEnvelope,
  validateSubmitEditorCommand,
} from '../protocol';

const SESSION_ID = 'session-test-1';
const PRIMARY = 'main';
const AUX = 'window-aux-1';

function makeSnapshot(_windowId: string, _hosted: string[]) {
  return {
    revision: 0,
    openDocuments: [{ id: 'doc-1', name: 'Design', dirty: false }],
    activeDocumentId: 'doc-1',
    workspaceMode: 'design',
    theme: 'dark',
    locale: 'en',
    selection: [],
    commandAvailability: { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null },
    panelLayout: { kind: 'empty', id: 'root' },
    panelLocalState: [],
  };
}

interface BrokerHarness {
  broker: SessionBroker;
  sent: SessionEnvelope[];
  applyCommand: ReturnType<typeof vi.fn>;
}

function makeBroker(
  overrides: Partial<import('../broker').SessionBrokerOptions> = {},
): BrokerHarness {
  const sent: SessionEnvelope[] = [];
  let revisionCounter = 0;
  const applyCommand = vi.fn(
    (_command: import('../protocol').SubmitEditorCommand): BrokerCommandResult => {
      revisionCounter += 1;
      return { kind: 'ok', newRevision: revisionCounter };
    },
  );
  const broker = new SessionBroker({
    sessionId: SESSION_ID,
    primaryWindowId: PRIMARY,
    emit: (envelope) => sent.push(envelope),
    applyCommand,
    projectSnapshot: (windowId, hosted) => {
      // Snapshot revision is decoupled from the broker's internal revision
      // here — the wiring that ties them lives in the M8 provider bridge.
      const snapshot = makeSnapshot(windowId, hosted);
      return { ...snapshot, revision: 0 };
    },
    canPanelCommand: (_panelInstanceId, _commandType) => true,
    createId: () => `evt-${sent.length + 1}`,
    ...overrides,
  });
  return { broker, sent, applyCommand };
}

function registerAux(harness: BrokerHarness, windowId = AUX, panels: string[] = ['instance-1']) {
  const envelope = createEnvelope({
    sessionId: SESSION_ID,
    senderWindowId: windowId,
    senderGeneration: 0,
    target: { kind: 'broker' },
    kind: 'WINDOW_READY',
    payload: { role: 'auxiliary', hostedPanelInstanceIds: panels },
    sequence: 1,
  });
  return harness.broker.handleEnvelope(envelope);
}

function submitCommand(
  harness: BrokerHarness,
  overrides: Partial<import('../protocol').SubmitEditorCommand> = {},
  sequence = 2,
): BrokerOutcomeLike {
  const command = {
    commandId: 'cmd-1',
    originWindowId: AUX,
    originPanelInstanceId: 'instance-1',
    activeDocumentId: 'doc-1',
    commandType: 'set-opacity',
    payload: { value: 0.5 },
    ...overrides,
  };
  const envelope = createEnvelope({
    sessionId: SESSION_ID,
    senderWindowId: AUX,
    senderGeneration: 0,
    target: { kind: 'broker' },
    kind: 'COMMAND_SUBMIT',
    payload: { command },
    sequence,
  });
  return harness.broker.handleEnvelope(envelope);
}

type BrokerOutcomeLike = ReturnType<SessionBroker['handleEnvelope']>;

describe('protocol: envelope validation', () => {
  const context = { sessionId: SESSION_ID };

  function envelope(overrides: Partial<SessionEnvelope> = {}): unknown {
    const base = createEnvelope({
      sessionId: SESSION_ID,
      senderWindowId: AUX,
      senderGeneration: 0,
      target: { kind: 'broker' },
      kind: 'HEARTBEAT',
      payload: { hostedPanelInstanceIds: [] },
      sequence: 1,
    });
    // Overrides apply to the final envelope — createEnvelope hardcodes the
    // protocol version, so malformed envelopes are built here directly.
    return { ...base, ...overrides };
  }

  it('accepts a valid envelope', () => {
    const result = validateEnvelope(envelope(), context);
    expect(result.ok).toBe(true);
  });

  it('rejects unknown protocol versions', () => {
    const result = validateEnvelope(envelope({ protocolVersion: 999 }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('protocol version');
  });

  it('rejects wrong session ids', () => {
    const result = validateEnvelope(envelope({ sessionId: 'other-session' }), context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('session');
  });

  it('rejects invalid sender ids and generations', () => {
    expect(validateEnvelope(envelope({ senderWindowId: '' }), context).ok).toBe(false);
    expect(validateEnvelope(envelope({ senderWindowId: 'has spaces!' }), context).ok).toBe(false);
    expect(validateEnvelope(envelope({ senderGeneration: -1 }), context).ok).toBe(false);
    expect(validateEnvelope(envelope({ senderGeneration: 1.5 }), context).ok).toBe(false);
  });

  it('rejects duplicate or malformed event ids and sequences', () => {
    expect(validateEnvelope(envelope({ eventId: '' }), context).ok).toBe(false);
    expect(validateEnvelope(envelope({ sequence: -2 }), context).ok).toBe(false);
    expect(validateEnvelope(envelope({ sentAt: Number.NaN }), context).ok).toBe(false);
  });

  it('rejects unknown kinds and invalid targets', () => {
    expect(validateEnvelope(envelope({ kind: 'MAGIC_MESSAGE' as never }), context).ok).toBe(false);
    expect(validateEnvelope(envelope({ target: { kind: 'nowhere' } as never }), context).ok).toBe(
      false,
    );
  });

  it('rejects oversized payloads', () => {
    const big = envelope({ payload: { blob: 'x'.repeat(MAX_ENVELOPE_PAYLOAD_BYTES + 1) } });
    const result = validateEnvelope(big, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('too large');
  });

  it('rejects non-serializable payloads', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(validateEnvelope(envelope({ payload: cyclic }), context).ok).toBe(false);
  });

  it('validates command shape', () => {
    expect(
      validateSubmitEditorCommand({
        commandId: 'c1',
        originWindowId: 'w1',
        originPanelInstanceId: 'p1',
        activeDocumentId: 'd1',
        commandType: 'x',
        payload: {},
      }),
    ).not.toBeNull();
    expect(
      validateSubmitEditorCommand({
        commandId: '',
        originWindowId: 'w1',
        originPanelInstanceId: 'p1',
        activeDocumentId: 'd1',
        commandType: 'x',
        payload: {},
      }),
    ).toBeNull();
    expect(validateSubmitEditorCommand(null)).toBeNull();
    expect(
      validateSubmitEditorCommand({
        commandId: 'c1',
        originWindowId: 'w1',
        originPanelInstanceId: 'p1',
        activeDocumentId: 'd1',
        commandType: 'x',
      }),
    ).toBeNull();
  });
});

describe('broker: registration and snapshots', () => {
  it('registers an auxiliary window and sends an initial snapshot', () => {
    const harness = makeBroker();
    const outcome = registerAux(harness);
    expect(outcome.kind).toBe('snapshot-sent');
    expect(harness.broker.isWindowRegistered(AUX)).toBe(true);
    const snapshot = harness.sent.find((e) => e.kind === 'SNAPSHOT');
    expect(snapshot).toBeDefined();
    expect(snapshot?.target).toEqual({ kind: 'window', windowId: AUX });
    expect(snapshot?.protocolVersion).toBe(SESSION_PROTOCOL_VERSION);
  });

  it('assigns a fresh generation on re-registration', () => {
    const harness = makeBroker();
    registerAux(harness);
    registerAux(harness);
    const registrations = harness.broker.listRegistrations();
    const aux = registrations.find((r) => r.windowId === AUX);
    expect(aux?.generation).toBe(1);
  });

  it('rejects messages from unregistered windows', () => {
    const harness = makeBroker();
    const outcome = submitCommand(harness);
    expect(outcome.kind).toBe('dropped');
    if (outcome.kind === 'dropped') expect(outcome.reason).toContain('not registered');
  });

  it('rejects stale generations after reload', () => {
    const harness = makeBroker();
    registerAux(harness);
    registerAux(harness); // generation now 1
    const outcome = submitCommand(harness); // still claims generation 0
    expect(outcome.kind).toBe('dropped');
    if (outcome.kind === 'dropped') expect(outcome.reason).toContain('stale generation');
  });

  it('rejects out-of-order sequences', () => {
    const harness = makeBroker();
    registerAux(harness);
    harness.broker.handleEnvelope(
      createEnvelope({
        sessionId: SESSION_ID,
        senderWindowId: AUX,
        senderGeneration: 0,
        target: { kind: 'broker' },
        kind: 'HEARTBEAT',
        payload: { hostedPanelInstanceIds: [] },
        sequence: 5,
      }),
    );
    const late = harness.broker.handleEnvelope(
      createEnvelope({
        sessionId: SESSION_ID,
        senderWindowId: AUX,
        senderGeneration: 0,
        target: { kind: 'broker' },
        kind: 'HEARTBEAT',
        payload: { hostedPanelInstanceIds: [] },
        sequence: 3,
      }),
    );
    expect(late.kind).toBe('dropped');
    if (late.kind === 'dropped') expect(late.reason).toContain('out-of-order');
  });

  it('rejects duplicate event ids', () => {
    const harness = makeBroker();
    registerAux(harness);
    const envelope = createEnvelope({
      sessionId: SESSION_ID,
      senderWindowId: AUX,
      senderGeneration: 0,
      target: { kind: 'broker' },
      kind: 'HEARTBEAT',
      payload: { hostedPanelInstanceIds: [] },
      sequence: 2,
      eventId: 'dup-event',
    });
    expect(harness.broker.handleEnvelope(envelope).kind).toBe('ok');
    expect(harness.broker.handleEnvelope(envelope).kind).toBe('dropped');
  });

  it('allows only the designated primary to register as primary', () => {
    const harness = makeBroker();
    const imposter = createEnvelope({
      sessionId: SESSION_ID,
      senderWindowId: 'evil-window',
      senderGeneration: 0,
      target: { kind: 'broker' },
      kind: 'WINDOW_READY',
      payload: { role: 'primary', hostedPanelInstanceIds: [] },
      sequence: 1,
    });
    expect(harness.broker.handleEnvelope(imposter).kind).toBe('dropped');
  });

  it('enforces the auxiliary window limit', () => {
    const harness = makeBroker({ maxAuxiliaryWindows: 1 });
    registerAux(harness, 'window-a');
    registerAux(harness, 'window-b');
    expect(harness.broker.listRegistrations().filter((r) => r.role === 'auxiliary')).toHaveLength(
      1,
    );
  });
});

describe('broker: heartbeat liveness', () => {
  it('marks windows expired after the timeout', () => {
    let now = 0;
    const harness = makeBroker({ now: () => now, heartbeatTimeoutMs: 1000 });
    registerAux(harness);
    now = 1001;
    const expired = harness.broker.getExpiredWindows();
    expect(expired.map((r) => r.windowId)).toContain(AUX);
  });

  it('keeps windows alive while heartbeats arrive', () => {
    let now = 0;
    const harness = makeBroker({ now: () => now, heartbeatTimeoutMs: 1000 });
    registerAux(harness);
    now = 900;
    harness.broker.handleEnvelope(
      createEnvelope({
        sessionId: SESSION_ID,
        senderWindowId: AUX,
        senderGeneration: 0,
        target: { kind: 'broker' },
        kind: 'HEARTBEAT',
        payload: { hostedPanelInstanceIds: [] },
        sequence: 2,
      }),
    );
    now = 1800;
    expect(harness.broker.getExpiredWindows()).toEqual([]);
  });

  it('unregisters on WINDOW_CLOSING', () => {
    const harness = makeBroker();
    registerAux(harness);
    harness.broker.handleEnvelope(
      createEnvelope({
        sessionId: SESSION_ID,
        senderWindowId: AUX,
        senderGeneration: 0,
        target: { kind: 'broker' },
        kind: 'WINDOW_CLOSING',
        payload: { reason: 'user' },
        sequence: 2,
      }),
    );
    expect(harness.broker.isWindowRegistered(AUX)).toBe(false);
    const after = submitCommand(harness, {}, 3);
    expect(after.kind).toBe('dropped');
  });
});

describe('broker: commands', () => {
  it('applies a valid command once and acks with the new revision', () => {
    const harness = makeBroker();
    registerAux(harness);
    const outcome = submitCommand(harness);
    expect(outcome.kind).toBe('command-applied');
    expect(harness.applyCommand).toHaveBeenCalledTimes(1);
    const ack = harness.sent.find((e) => e.kind === 'COMMAND_ACK');
    expect(ack).toBeDefined();
  });

  it('rejects duplicate commands by commandId (retry safety)', () => {
    const harness = makeBroker();
    registerAux(harness);
    submitCommand(harness);
    const second = submitCommand(harness);
    expect(second.kind).toBe('dropped');
    if (second.kind === 'dropped') expect(second.reason).toContain('duplicate command');
    expect(harness.applyCommand).toHaveBeenCalledTimes(1);
  });

  it('rejects stale commands (expectedRevision mismatch)', () => {
    const harness = makeBroker();
    registerAux(harness);
    const outcome = submitCommand(harness, { expectedRevision: 99 });
    expect(outcome.kind).toBe('command-rejected');
    const reject = harness.sent.find((e) => e.kind === 'COMMAND_REJECT');
    expect(reject).toBeDefined();
    expect(harness.applyCommand).not.toHaveBeenCalled();
  });

  it('rejects commands whose origin panel is not hosted by the sender', () => {
    const harness = makeBroker();
    registerAux(harness, AUX, ['other-instance']);
    const outcome = submitCommand(harness);
    expect(outcome.kind).toBe('command-rejected');
    if (outcome.kind === 'command-rejected') expect(outcome.reason).toContain('unhosted');
  });

  it('rejects commands the panel cannot perform', () => {
    const harness = makeBroker({
      canPanelCommand: (_panel, commandType) => commandType !== 'set-opacity',
    });
    registerAux(harness);
    const outcome = submitCommand(harness);
    expect(outcome.kind).toBe('command-rejected');
    if (outcome.kind === 'command-rejected')
      expect(outcome.reason).toContain('does not allow command');
  });

  it('forwards applyCommand rejections as COMMAND_REJECT', () => {
    const harness = makeBroker({
      applyCommand: () => ({ kind: 'rejected', reason: 'document is read-only' }),
    });
    registerAux(harness);
    const outcome = submitCommand(harness);
    expect(outcome.kind).toBe('command-rejected');
    if (outcome.kind === 'command-rejected') expect(outcome.reason).toContain('read-only');
  });

  it('rejects commands with a mismatched origin window', () => {
    const harness = makeBroker();
    registerAux(harness);
    const outcome = submitCommand(harness, { originWindowId: 'other-window' });
    expect(outcome.kind).toBe('command-rejected');
  });
});

describe('broker: snapshots, resync, patches', () => {
  it('sends a fresh snapshot on SNAPSHOT_REQUEST and RESYNC_REQUEST', () => {
    const harness = makeBroker();
    registerAux(harness);
    harness.broker.handleEnvelope(
      createEnvelope({
        sessionId: SESSION_ID,
        senderWindowId: AUX,
        senderGeneration: 0,
        target: { kind: 'broker' },
        kind: 'SNAPSHOT_REQUEST',
        payload: { reason: 'resync', lastRevision: 0 },
        sequence: 2,
      }),
    );
    const snapshots = harness.sent.filter((e) => e.kind === 'SNAPSHOT');
    expect(snapshots).toHaveLength(2);
  });

  it('publishes patches only to auxiliary windows', async () => {
    const harness = makeBroker();
    harness.broker.registerWindow(PRIMARY, 'primary', []);
    registerAux(harness);
    harness.broker.publishPatch('selection', { ids: ['a'] }, 0);
    await Promise.resolve();
    const patches = harness.sent.filter((e) => e.kind === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.target).toEqual({ kind: 'window', windowId: AUX });
  });

  it('coalesces patches of the same kind within one flush (last wins)', async () => {
    const harness = makeBroker();
    registerAux(harness);
    harness.broker.publishPatch('selection', { ids: ['a'] }, 0);
    harness.broker.publishPatch('selection', { ids: ['b'] }, 0);
    await Promise.resolve();
    const patches = harness.sent.filter((e) => e.kind === 'PATCH');
    expect(patches).toHaveLength(1);
    const payload = patches[0]?.payload as { patches: Array<{ payload: { ids: string[] } }> };
    expect(payload.patches[0]?.payload.ids).toEqual(['b']);
  });

  it('bumps the session revision on published patches', async () => {
    const harness = makeBroker();
    registerAux(harness);
    const before = harness.broker.getRevision();
    harness.broker.publishPatch('selection', { ids: [] }, 0);
    await Promise.resolve();
    expect(harness.broker.getRevision()).toBe(before + 1);
  });

  it('supports manual flush for batch updates', () => {
    const harness = makeBroker();
    registerAux(harness);
    harness.broker.publishPatch('a', 1, 0);
    harness.broker.flushPatches(harness.broker.getRevision(), 0);
    const patches = harness.sent.filter((e) => e.kind === 'PATCH');
    expect(patches).toHaveLength(1);
  });
});

describe('broker: security hardening', () => {
  it('rejects envelopes with wrong session ids at the broker', () => {
    const harness = makeBroker();
    const envelope = createEnvelope({
      sessionId: 'other-session',
      senderWindowId: AUX,
      senderGeneration: 0,
      target: { kind: 'broker' },
      kind: 'HEARTBEAT',
      payload: { hostedPanelInstanceIds: [] },
      sequence: 1,
    });
    expect(harness.broker.handleEnvelope(envelope).kind).toBe('dropped');
  });

  it('rejects structurally invalid payloads per kind', () => {
    const harness = makeBroker();
    registerAux(harness);
    const envelope = createEnvelope({
      sessionId: SESSION_ID,
      senderWindowId: AUX,
      senderGeneration: 0,
      target: { kind: 'broker' },
      kind: 'HEARTBEAT',
      payload: { hostedPanelInstanceIds: 'not-an-array' },
      sequence: 2,
    });
    const outcome = harness.broker.handleEnvelope(envelope);
    expect(outcome.kind).toBe('dropped');
    if (outcome.kind === 'dropped') expect(outcome.reason).toContain('invalid payload');
  });

  it('rejects malformed COMMAND_SUBMIT payloads', () => {
    const harness = makeBroker();
    registerAux(harness);
    const envelope = createEnvelope({
      sessionId: SESSION_ID,
      senderWindowId: AUX,
      senderGeneration: 0,
      target: { kind: 'broker' },
      kind: 'COMMAND_SUBMIT',
      payload: { command: { commandId: 'x' } },
      sequence: 2,
    });
    expect(harness.broker.handleEnvelope(envelope).kind).toBe('dropped');
  });
});
