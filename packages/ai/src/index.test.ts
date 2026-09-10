import { createDocument, type Document } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { chat, createAssistant } from './index';

const doc: Document = createDocument('Test');

describe('chat', () => {
  it('dispatches to a real on-device command when the message matches and context is given', async () => {
    const reply = await chat('s1', 'scan for debt', { document: doc });
    expect(reply.role).toBe('assistant');
    expect(reply.content).toMatch(/design debt/);
  });

  it('answers instantly — no simulated latency', async () => {
    const started = Date.now();
    const reply = await chat('s1', 'check contrast', { document: doc });
    expect(Date.now() - started).toBeLessThan(50);
    expect(reply.content).toMatch(/contrast/i);
  });

  it('lists the real on-device commands for an unknown intent', async () => {
    const reply = await chat('s1', 'hello there', { document: doc });
    expect(reply.content).toMatch(/on-device/);
    expect(reply.content).toMatch(/Check contrast/);
    expect(reply.content).toMatch(/Scan for design debt/);
    // No canned personality reply.
    expect(reply.content).not.toMatch(/Hello! How can I help/i);
  });

  it('explains the editor context requirement when no context is supplied', async () => {
    const reply = await chat('s1', 'scan for debt');
    expect(reply.content).toMatch(/Open me from the editor/);
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
