// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { createDocument, type Document } from '@strata/scene';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../context';
import { AIPanel } from './AIPanel';

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

describe('AIPanel — intelligence command dispatch', () => {
  it('responds to "scan for debt" with a real debt-scan result, not the generic mock reply', async () => {
    renderPanel(createDocument('Debtor'));
    await sendMessage('scan for debt');

    await waitFor(
      () => {
        const bubbles = screen.getAllByText(/./, { selector: '.ai-panel__bubble-content' });
        const assistantReply = bubbles[bubbles.length - 1];
        expect(assistantReply?.textContent).not.toMatch(/Strata AI assistant/i);
      },
      { timeout: 3000 },
    );
  });

  it('still falls back to the generic mock reply for unrelated messages', async () => {
    renderPanel(createDocument('Empty'));
    await sendMessage('hello there');

    await waitFor(
      () => {
        const bubbles = screen.getAllByText(/./, { selector: '.ai-panel__bubble-content' });
        const assistantReply = bubbles[bubbles.length - 1];
        expect(assistantReply?.textContent).toMatch(/Hello! How can I help/i);
      },
      { timeout: 3000 },
    );
  });
});
