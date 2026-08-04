// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { addKeyframe, addTrack, createDocument, createTimeline } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { MotionSpecSection } from './MotionSpecSection';

describe('MotionSpecSection', () => {
  it('renders nothing when document has no timelines', () => {
    const doc = createDocument('Empty');
    const { container } = render(<MotionSpecSection doc={doc} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows timeline summary with export hash', () => {
    let doc = createDocument('Motion doc');
    const { doc: d1, id: tlId } = createTimeline(doc, 'Intro', 3000);
    const { doc: d2, trackId } = addTrack(d1, tlId, 'node-1', 'opacity');
    doc = addKeyframe(d2, tlId, trackId, { progress: 0, value: 0 });
    doc = addKeyframe(doc, tlId, trackId, { progress: 1, value: 1 });

    render(<MotionSpecSection doc={doc} />);

    expect(screen.getByRole('region', { name: 'Motion timelines' })).toBeTruthy();
    expect(screen.getByText('Intro')).toBeTruthy();
    expect(screen.getByText(/3000ms · 1 tracks · 2 keyframes/)).toBeTruthy();
    expect(screen.getByText(/Export hash:/)).toBeTruthy();
  });
});
