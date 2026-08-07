/**
 * Command router tests (ADR-0212).
 *
 * Tests command registration, validation, client submission,
 * acknowledgement handling, and expiry.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandClient,
  getCommandDefinition,
  registerBuiltinCommands,
  registerCommand,
  resetCommandRegistry,
  validateCommandSubmission,
} from '../commandRouter';

describe('commandRouter: registration', () => {
  beforeEach(() => {
    resetCommandRegistry();
  });

  it('registers built-in commands', () => {
    registerBuiltinCommands();
    expect(getCommandDefinition('updateNodeProperties')).toBeDefined();
    expect(getCommandDefinition('setSelection')).toBeDefined();
    expect(getCommandDefinition('undo')).toBeDefined();
    expect(getCommandDefinition('redo')).toBeDefined();
  });

  it('returns undefined for unknown command types', () => {
    expect(getCommandDefinition('nonexistent')).toBeUndefined();
  });

  it('custom commands can be registered', () => {
    registerCommand({
      type: 'customAction',
      mutatesDocument: true,
      idempotent: false,
      maxPayloadBytes: 1024,
    });
    expect(getCommandDefinition('customAction')).toBeDefined();
  });
});

describe('commandRouter: validation', () => {
  beforeEach(() => {
    resetCommandRegistry();
    registerBuiltinCommands();
  });

  it('rejects empty command type', () => {
    const errors = validateCommandSubmission({
      commandType: '',
      originWindowId: 'w1',
      originPanelInstanceId: 'pi-1',
      activeDocumentId: 'doc-1',
      payload: {},
    });
    expect(errors.some((e) => e.field === 'commandType')).toBe(true);
  });

  it('rejects unknown command type', () => {
    const errors = validateCommandSubmission({
      commandType: 'unknownCommand',
      originWindowId: 'w1',
      originPanelInstanceId: 'pi-1',
      activeDocumentId: 'doc-1',
      payload: {},
    });
    expect(errors.some((e) => e.field === 'commandType')).toBe(true);
  });

  it('rejects empty origin window id', () => {
    const errors = validateCommandSubmission({
      commandType: 'setSelection',
      originWindowId: '',
      originPanelInstanceId: 'pi-1',
      activeDocumentId: 'doc-1',
      payload: {},
    });
    expect(errors.some((e) => e.field === 'originWindowId')).toBe(true);
  });

  it('rejects empty panel instance id', () => {
    const errors = validateCommandSubmission({
      commandType: 'setSelection',
      originWindowId: 'w1',
      originPanelInstanceId: '',
      activeDocumentId: 'doc-1',
      payload: {},
    });
    expect(errors.some((e) => e.field === 'originPanelInstanceId')).toBe(true);
  });

  it('rejects oversized payload', () => {
    const bigPayload = { data: 'x'.repeat(5000) };
    const errors = validateCommandSubmission({
      commandType: 'updateNodeProperties',
      originWindowId: 'w1',
      originPanelInstanceId: 'pi-1',
      activeDocumentId: 'doc-1',
      payload: bigPayload,
    });
    expect(errors.some((e) => e.field === 'payload')).toBe(true);
  });

  it('accepts valid command', () => {
    const errors = validateCommandSubmission({
      commandType: 'setSelection',
      originWindowId: 'w1',
      originPanelInstanceId: 'pi-1',
      activeDocumentId: 'doc-1',
      payload: { nodeIds: ['n1'] },
    });
    expect(errors).toEqual([]);
  });
});

describe('commandRouter: CommandClient', () => {
  it('submits commands and tracks pending state', () => {
    const sendFn = vi.fn();
    const client = new CommandClient('aux-1', sendFn);

    const cmdId = client.submit({
      commandType: 'setSelection',
      panelInstanceId: 'pi-1',
      activeDocumentId: 'doc-1',
      payload: { nodeIds: ['n1'] },
    });

    expect(cmdId).toBeTruthy();
    expect(sendFn).toHaveBeenCalledOnce();
    expect(client.getCommandStatus(cmdId)).toBe('pending');
    expect(client.getPendingCommands()).toHaveLength(1);
  });

  it('handles acknowledgement', () => {
    const client = new CommandClient('aux-1', vi.fn());
    const cmdId = client.submit({
      commandType: 'setSelection',
      panelInstanceId: 'pi-1',
      activeDocumentId: 'doc-1',
      payload: { nodeIds: ['n1'] },
    });

    client.handleAck({ commandId: cmdId, accepted: true });
    expect(client.getCommandStatus(cmdId)).toBe('acknowledged');
  });

  it('handles rejection', () => {
    const client = new CommandClient('aux-1', vi.fn());
    const cmdId = client.submit({
      commandType: 'setSelection',
      panelInstanceId: 'pi-1',
      activeDocumentId: 'doc-1',
      payload: { nodeIds: ['n1'] },
    });

    client.handleAck({ commandId: cmdId, accepted: false, reason: 'stale revision' });
    expect(client.getCommandStatus(cmdId)).toBe('rejected');
  });

  it('ignores ack for unknown command', () => {
    const client = new CommandClient('aux-1', vi.fn());
    client.handleAck({ commandId: 'nonexistent', accepted: true });
    // No error thrown
  });

  it('throws on too many pending commands', () => {
    const client = new CommandClient('aux-1', vi.fn(), 2);
    client.submit({
      commandType: 'setSelection',
      panelInstanceId: 'pi-1',
      activeDocumentId: 'doc-1',
      payload: {},
    });
    client.submit({
      commandType: 'setSelection',
      panelInstanceId: 'pi-1',
      activeDocumentId: 'doc-1',
      payload: {},
    });
    expect(() =>
      client.submit({
        commandType: 'setSelection',
        panelInstanceId: 'pi-1',
        activeDocumentId: 'doc-1',
        payload: {},
      }),
    ).toThrow(/too many pending commands/);
  });

  it('reset clears all state', () => {
    const client = new CommandClient('aux-1', vi.fn());
    client.submit({
      commandType: 'setSelection',
      panelInstanceId: 'pi-1',
      activeDocumentId: 'doc-1',
      payload: {},
    });
    client.reset();
    expect(client.getPendingCommands()).toHaveLength(0);
  });
});
