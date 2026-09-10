// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmailCodeEditor } from './EmailCodeEditor';

describe('EmailCodeEditor', () => {
  it('renders highlighted source with line numbers and supports replace-all', () => {
    const onChange = vi.fn();
    render(
      <EmailCodeEditor
        label="Email-safe HTML"
        language="markup"
        value={'<p>Hi</p>\n<p>Hi again</p>'}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Email-safe HTML' })).toBeVisible();
    expect(screen.getByText('2 lines')).toBeVisible();
    expect(screen.getByText('1', { selector: '.email-code-editor__line-number' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in email code' }), {
      target: { value: 'Hi' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Replace in email code' }), {
      target: { value: 'Hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    expect(onChange).toHaveBeenCalledWith('<p>Hello</p>\n<p>Hello again</p>');
  });

  it('keeps generated code read-only and does not expose replacement controls', () => {
    render(
      <EmailCodeEditor
        label="Generated email HTML"
        language="markup"
        value="<p>Generated</p>"
        readOnly
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Generated email HTML' })).toHaveAttribute(
      'readonly',
    );
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
  });

  it('selects a mapped generated range in read-only mode', () => {
    render(
      <EmailCodeEditor
        label="Generated email HTML"
        language="markup"
        value={'<p>Mapped</p>\n<p>Other</p>'}
        readOnly
        sourceRange={{ startOffset: 0, endOffset: 13 }}
      />,
    );
    const editor = screen.getByRole('textbox', { name: 'Generated email HTML' });
    expect(editor).toHaveValue('<p>Mapped</p>\n<p>Other</p>');
    expect(editor).toHaveAttribute('readonly');
    expect((editor as HTMLTextAreaElement).selectionStart).toBe(0);
    expect((editor as HTMLTextAreaElement).selectionEnd).toBe(13);
  });
});
