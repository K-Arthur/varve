// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDocument, type Document } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { EditorProvider } from '../context';
import { AIPanel } from './AIPanel';

vi.setConfig({ testTimeout: 30000 });

function renderPanel(doc?: Document) {
  return render(
    <EditorProvider initialDocumentJson={doc ? JSON.stringify(doc) : undefined}>
      <AIPanel />
    </EditorProvider>,
  );
}

async function sendMessage(text: string) {
  const textarea = screen.getByLabelText('Chat message');
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByLabelText('Send message'));
}

function lastAssistantReply(): HTMLElement | null {
  const bubbles = screen.getAllByText(/./, { selector: '.ai-panel__bubble-content' });
  return bubbles.length > 0 ? (bubbles[bubbles.length - 1] ?? null) : null;
}

describe('AIPanel — on-device assistant', () => {
  it('presents itself honestly as an on-device assistant', () => {
    renderPanel(createDocument('Empty'));
    expect(screen.getByText('Design Assistant')).toBeTruthy();
    expect(screen.getByText('On-device — works offline')).toBeTruthy();
    // The suggestion chips describe commands that actually exist.
    expect(screen.getByRole('button', { name: 'Check contrast on my design' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scan for design debt' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Suggest layer names' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Harmonize spacing' })).toBeTruthy();
  });

  it('responds to "scan for debt" with a real debt-scan result', async () => {
    renderPanel(createDocument('Debtor'));
    await sendMessage('scan for debt');

    await waitFor(
      () => {
        expect(lastAssistantReply()?.textContent).toMatch(/design debt/i);
      },
      { timeout: 3000 },
    );
  });

  it('answers unknown intents honestly instead of pretending a model exists', async () => {
    renderPanel(createDocument('Empty'));
    await sendMessage('hello there');

    await waitFor(
      () => {
        expect(lastAssistantReply()?.textContent).toMatch(/on-device design assistant/i);
        expect(lastAssistantReply()?.textContent).toMatch(/Check contrast/);
      },
      { timeout: 3000 },
    );
    // No canned personality reply, no fake model identity.
    expect(lastAssistantReply()?.textContent).not.toMatch(/Hello! How can I help/i);
  });

  it('does not render dead Apply/Preview action buttons', async () => {
    renderPanel(createDocument('Empty'));
    await sendMessage('check contrast');
    await waitFor(
      () => {
        expect(lastAssistantReply()?.textContent).toMatch(/contrast/i);
      },
      { timeout: 3000 },
    );
    expect(screen.queryByRole('button', { name: 'Apply suggestion' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview suggestion' })).toBeNull();
  });
});
