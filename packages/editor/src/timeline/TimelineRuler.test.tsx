import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineRuler } from './TimelineRuler';

describe('TimelineRuler', () => {
  const defaultProps = {
    duration: 5000,
    currentTime: 0,
    zoom: 1,
    onSeek: vi.fn(),
  };

  it('calls onAddMarker on double-click', () => {
    const onAddMarker = vi.fn();
    const { container } = render(<TimelineRuler {...defaultProps} onAddMarker={onAddMarker} />);
    const ruler = container.querySelector('.timeline-ruler');
    expect(ruler).toBeTruthy();
    if (ruler) {
      const rect = ruler.getBoundingClientRect();
      fireEvent.doubleClick(ruler, { clientX: rect.left + 2500, clientY: rect.top + 5 });
      expect(onAddMarker).toHaveBeenCalledOnce();
      const time = onAddMarker.mock.calls[0]?.[0] as number;
      expect(time).toBeGreaterThan(2400);
      expect(time).toBeLessThan(2600);
    }
  });

  it('shows marker context menu on right-click', () => {
    const onDeleteMarker = vi.fn();
    render(
      <TimelineRuler
        {...defaultProps}
        markers={[{ id: 'm1', name: 'Beat', progress: 0.5 }]}
        onDeleteMarker={onDeleteMarker}
      />,
    );
    const marker = screen.getByLabelText('Marker: Beat');
    fireEvent.contextMenu(marker);
    expect(screen.getByRole('menu', { name: 'Marker context menu' })).toBeTruthy();
    fireEvent.click(screen.getByText('Delete marker'));
    expect(onDeleteMarker).toHaveBeenCalledWith('m1');
  });

  it('calls onRenameMarker from context menu', () => {
    const onRenameMarker = vi.fn();
    render(
      <TimelineRuler
        {...defaultProps}
        markers={[{ id: 'm1', name: 'Beat', progress: 0.5 }]}
        onRenameMarker={onRenameMarker}
      />,
    );
    fireEvent.contextMenu(screen.getByLabelText('Marker: Beat'));
    fireEvent.click(screen.getByText('Rename marker'));
    expect(onRenameMarker).toHaveBeenCalledWith('m1');
  });
});
