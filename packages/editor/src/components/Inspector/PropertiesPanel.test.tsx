// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../../context';
import { PropertiesPanel } from './PropertiesPanel';

function renderPanel() {
  return render(
    <EditorProvider>
      <PropertiesPanel />
    </EditorProvider>,
  );
}

describe('PropertiesPanel canvas settings', () => {
  it('renders empty-state canvas and document color sections', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Canvas' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Document Color' })).toBeTruthy();
    expect(screen.getByLabelText('Canvas background')).toBeTruthy();

    expect(screen.getByRole('button', { name: 'RGB' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'CMYK' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Grayscale' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('switches document color mode via the mode buttons', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'CMYK' }));

    expect(screen.getByRole('button', { name: 'CMYK' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'RGB' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Grayscale' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
