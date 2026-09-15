/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TerminationDialogHost } from '../TerminationDialogHost';
import type { PromptRequest } from '../types';

function makeRequest(overrides: Partial<PromptRequest> = {}): {
  request: PromptRequest;
  respond: (value: boolean) => void;
} {
  const respond = vi.fn();
  const request: PromptRequest = {
    promptId: 1,
    intent: 'quit-application',
    kind: 'unsaved',
    docs: [{ sessionId: 'a', name: 'Poster.varve', filePath: '/p/Poster.varve', untitled: false }],
    respond,
    ...overrides,
  };
  return { request, respond };
}

describe('TerminationDialogHost', () => {
  it('single dirty document: Save responds with a save choice', () => {
    const { request, respond } = makeRequest();
    render(<TerminationDialogHost request={request} onResponded={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(respond).toHaveBeenCalledWith({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'save' }],
    });
  });

  it("single dirty document: Don't Save responds with a discard choice", () => {
    const { request, respond } = makeRequest();
    render(<TerminationDialogHost request={request} onResponded={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: "Don't Save" }));
    expect(respond).toHaveBeenCalledWith({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'discard' }],
    });
  });

  it('single dirty document: Cancel responds with null (transaction cancelled)', () => {
    const { request, respond } = makeRequest();
    render(<TerminationDialogHost request={request} onResponded={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(respond).toHaveBeenCalledWith(null);
  });

  it('identifies the dirty filename in the message', () => {
    const { request } = makeRequest();
    render(<TerminationDialogHost request={request} onResponded={vi.fn()} />);
    expect(screen.getByText(/Poster\.varve/)).toBeTruthy();
  });

  it('warns that an untitled document needs a Save As location', () => {
    const { request } = makeRequest({
      docs: [{ sessionId: 'a', name: 'Untitled', untitled: true }],
    });
    render(<TerminationDialogHost request={request} onResponded={vi.fn()} />);
    expect(screen.getByText(/has never been saved/)).toBeTruthy();
  });

  it('multiple documents: Save Selected only covers checked rows', () => {
    const { request, respond } = makeRequest({
      docs: [
        { sessionId: 'a', name: 'A.varve', filePath: '/p/a.varve', untitled: false },
        { sessionId: 'b', name: 'B.varve', filePath: '/p/b.varve', untitled: false },
        { sessionId: 'c', name: 'C.varve', filePath: '/p/c.varve', untitled: false },
      ],
    });
    render(<TerminationDialogHost request={request} onResponded={vi.fn()} />);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]!); // uncheck B
    fireEvent.click(screen.getByRole('button', { name: /Save Selected \(2\)/ }));
    expect(respond).toHaveBeenCalledWith({
      kind: 'proceed',
      choices: [
        { sessionId: 'a', choice: 'save' },
        { sessionId: 'c', choice: 'save' },
      ],
    });
  });

  it('multiple documents: Discard All covers every row', () => {
    const { request, respond } = makeRequest({
      docs: [
        { sessionId: 'a', name: 'A.varve', filePath: '/p/a.varve', untitled: false },
        { sessionId: 'b', name: 'B.varve', filePath: '/p/b.varve', untitled: false },
      ],
    });
    render(<TerminationDialogHost request={request} onResponded={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Discard All' }));
    expect(respond).toHaveBeenCalledWith({
      kind: 'proceed',
      choices: [
        { sessionId: 'a', choice: 'discard' },
        { sessionId: 'b', choice: 'discard' },
      ],
    });
  });

  it('long filenames truncate with the full name available as a tooltip', () => {
    const longName = 'A-Really-Extremely-Long-Design-Filename-That-Does-Not-Fit.varve';
    const { request } = makeRequest({
      docs: [{ sessionId: 'a', name: longName, filePath: '/p/x.varve', untitled: false }],
    });
    render(<TerminationDialogHost request={request} onResponded={vi.fn()} />);
    const name = screen.getByTitle(longName);
    expect(name.textContent).toContain('\u2026');
    expect(name.textContent?.length).toBeLessThan(longName.length);
  });

  it('save-failed dialog offers Try Again / Save As / Discard per document', () => {
    const { request, respond } = makeRequest({
      kind: 'save-failed',
      docs: [
        {
          sessionId: 'a',
          name: 'Poster.varve',
          filePath: '/p/Poster.varve',
          untitled: false,
          failureCategory: 'disk-full',
        },
      ],
    });
    render(<TerminationDialogHost request={request} onResponded={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save As…' }));
    expect(respond).toHaveBeenCalledWith({
      kind: 'proceed',
      choices: [{ sessionId: 'a', choice: 'save-as' }],
    });
  });

  it('save-failed Cancel Quit responds with null', () => {
    const { request, respond } = makeRequest({
      kind: 'save-failed',
      docs: [
        {
          sessionId: 'a',
          name: 'Poster.varve',
          filePath: '/p/Poster.varve',
          untitled: false,
          failureCategory: 'unknown',
        },
      ],
    });
    render(<TerminationDialogHost request={request} onResponded={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Quit' }));
    expect(respond).toHaveBeenCalledWith(null);
  });

  it('calls onResponded after responding so the host closes the dialog', () => {
    const { request } = makeRequest();
    const onResponded = vi.fn();
    render(<TerminationDialogHost request={request} onResponded={onResponded} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResponded).toHaveBeenCalledWith(request);
  });
});
