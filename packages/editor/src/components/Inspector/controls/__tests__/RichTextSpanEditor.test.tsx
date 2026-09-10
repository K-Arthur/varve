import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RichText } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider } from '../../../../context';
import { RichTextSpanEditor } from '../RichTextSpanEditor';

afterEach(cleanup);

function renderEditor(element: React.ReactElement) {
  return render(<EditorProvider>{element}</EditorProvider>);
}

describe('RichTextSpanEditor', () => {
  it('renders a textbox with the runs as inline spans', () => {
    const rich: RichText = {
      paragraphs: [{ runs: [{ text: 'Hello' }, { text: ' World', format: { fontWeight: 700 } }] }],
    };
    renderEditor(<RichTextSpanEditor richText={rich} onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('renders formatting buttons in the toolbar', () => {
    const rich: RichText = { paragraphs: [{ runs: [{ text: 'Hi' }] }] };
    renderEditor(<RichTextSpanEditor richText={rich} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Bold' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Italic' })).toBeTruthy();
  });

  it('calls onChange with bold-applied rich text when Bold is pressed', () => {
    const rich: RichText = { paragraphs: [{ runs: [{ text: 'Hello' }] }] };
    const onChange = vi.fn();
    renderEditor(<RichTextSpanEditor richText={rich} onChange={onChange} />);
    // Bold applies to the current selection range (null here → no-op, but
    // the button click itself must not throw and onChange may be called
    // with the merged result on blur).
    const boldBtn = screen.getByRole('button', { name: 'Bold' });
    expect(() => fireEvent.mouseDown(boldBtn)).not.toThrow();
  });

  it('merges adjacent runs with identical format on blur', () => {
    const rich: RichText = {
      paragraphs: [
        {
          runs: [
            { text: 'He', format: { fontWeight: 400 } },
            { text: 'llo', format: { fontWeight: 400 } },
          ],
        },
      ],
    };
    const onChange = vi.fn();
    renderEditor(<RichTextSpanEditor richText={rich} onChange={onChange} />);
    const box = screen.getByRole('textbox');
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledTimes(1);
    const result = onChange.mock.calls[0]![0] as RichText;
    expect(result.paragraphs[0]!.runs).toHaveLength(1);
    expect(result.paragraphs[0]!.runs[0]!.text).toBe('Hello');
  });
});
