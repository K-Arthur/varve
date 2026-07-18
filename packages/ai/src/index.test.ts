import { createDocument, type Document } from '@strata/scene';
import { describe, expect, it, vi } from 'vitest';
import { chat, createAssistant } from './index';

const doc: Document = createDocument('Test');

describe('chat', () => {
  it('dispatches to a real intelligence command when the message matches and context is given', async () => {
    const reply = await chat('s1', 'scan for debt', { document: doc });
    expect(reply.role).toBe('assistant');
    expect(reply.content).not.toMatch(/Strata AI assistant/i);
  });

  it('falls back to the mock reply when no context is given', async () => {
    const reply = await chat('s1', 'scan for debt');
    expect(reply.role).toBe('assistant');
  });

  it('falls back to the mock reply when the message matches no command', async () => {
    const reply = await chat('s1', 'hello there', { document: doc });
    expect(reply.content).toMatch(/Hello/i);
  });

  it('delegates naming commands to the supplied handler', async () => {
    const suggestNames = vi.fn(() => 'Renamed 2 layers');
    const reply = await chat('s1', 'rename layers', {
      document: doc,
      handlers: { suggestNames },
    });
    expect(suggestNames).toHaveBeenCalled();
    expect(reply.content).toBe('Renamed 2 layers');
  });
});

describe('createAssistant', () => {
  it('accepts a per-message intelligence context in sendMessage', async () => {
    const assistant = createAssistant();
    const reply = await assistant.sendMessage('scan for debt', { document: doc });
    expect(reply.role).toBe('assistant');
    expect(assistant.session.messages).toHaveLength(2);
  });

  it('still works with no context (backward compatible)', async () => {
    const assistant = createAssistant();
    const reply = await assistant.sendMessage('hello');
    expect(reply.role).toBe('assistant');
  });
});
