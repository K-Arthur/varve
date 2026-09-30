// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConceptArtReferenceControls } from './ConceptArtReferenceControls';

afterEach(cleanup);

describe('ConceptArtReferenceControls', () => {
  it('marks an image as a reference with a safe source basename and both uses off', () => {
    const onChange = vi.fn();
    render(
      <ConceptArtReferenceControls
        metadata={undefined}
        sourceFileName="C:\\private\\moodboards\\forest.png"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Use as concept reference' }));

    expect(onChange).toHaveBeenCalledWith({
      sourceFileName: 'forest.png',
      includeInSampling: false,
      includeInExport: false,
    });
    expect(screen.queryByRole('switch', { name: 'Include in artwork sampling' })).toBeNull();
  });

  it('keeps sampling and export opt-ins independent', () => {
    const onChange = vi.fn();
    const metadata = {
      sourceFileName: 'forest.png',
      includeInSampling: false,
      includeInExport: false,
    };
    const { rerender } = render(
      <ConceptArtReferenceControls
        metadata={metadata}
        sourceFileName="ignored-name.png"
        onChange={onChange}
      />,
    );

    expect(screen.getByText('forest.png')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Include in artwork sampling' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...metadata, includeInSampling: true });

    rerender(
      <ConceptArtReferenceControls
        metadata={{ ...metadata, includeInSampling: true }}
        sourceFileName="ignored-name.png"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Include in artwork exports' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...metadata,
      includeInSampling: true,
      includeInExport: true,
    });
  });

  it('removes only the reference role when switched off', () => {
    const onChange = vi.fn();
    render(
      <ConceptArtReferenceControls
        metadata={{
          sourceFileName: 'forest.png',
          includeInSampling: true,
          includeInExport: true,
        }}
        sourceFileName="forest.png"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Use as concept reference' }));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
