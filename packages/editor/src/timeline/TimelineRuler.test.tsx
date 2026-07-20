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

  describe('keyboard navigation', () => {
    it('moves playhead right on ArrowRight', () => {
      const onSeek = vi.fn();
      const { container } = render(<TimelineRuler {...defaultProps} currentTime={1000} onSeek={onSeek} />);
      const ruler = container.querySelector('.timeline-ruler');
      expect(ruler).toBeTruthy();
      fireEvent.keyDown(ruler!, { key: 'ArrowRight' });
      expect(onSeek).toHaveBeenCalledWith(1100);
    });

    it('moves playhead left on ArrowLeft', () => {
      const onSeek = vi.fn();
      const { container } = render(<TimelineRuler {...defaultProps} currentTime={1000} onSeek={onSeek} />);
      const ruler = container.querySelector('.timeline-ruler');
      fireEvent.keyDown(ruler!, { key: 'ArrowLeft' });
      expect(onSeek).toHaveBeenCalledWith(900);
    });

    it('steps by 500ms with Shift+Arrow', () => {
      const onSeek = vi.fn();
      const { container } = render(<TimelineRuler {...defaultProps} currentTime={1000} onSeek={onSeek} />);
      const ruler = container.querySelector('.timeline-ruler');
      fireEvent.keyDown(ruler!, { key: 'ArrowRight', shiftKey: true });
      expect(onSeek).toHaveBeenCalledWith(1500);
    });

    it('goes to start on Home', () => {
      const onSeek = vi.fn();
      const { container } = render(<TimelineRuler {...defaultProps} currentTime={3000} onSeek={onSeek} />);
      const ruler = container.querySelector('.timeline-ruler');
      fireEvent.keyDown(ruler!, { key: 'Home' });
      expect(onSeek).toHaveBeenCalledWith(0);
    });

    it('goes to end on End', () => {
      const onSeek = vi.fn();
      const { container } = render(<TimelineRuler {...defaultProps} currentTime={0} onSeek={onSeek} />);
      const ruler = container.querySelector('.timeline-ruler');
      fireEvent.keyDown(ruler!, { key: 'End' });
      expect(onSeek).toHaveBeenCalledWith(5000);
    });

    it('clamps to 0 when stepping before start', () => {
      const onSeek = vi.fn();
      const { container } = render(<TimelineRuler {...defaultProps} currentTime={50} onSeek={onSeek} />);
      const ruler = container.querySelector('.timeline-ruler');
      fireEvent.keyDown(ruler!, { key: 'ArrowLeft' });
      expect(onSeek).toHaveBeenCalledWith(0);
    });

    it('clamps to duration when stepping beyond end', () => {
      const onSeek = vi.fn();
      const { container } = render(<TimelineRuler {...defaultProps} currentTime={4950} onSeek={onSeek} />);
      const ruler = container.querySelector('.timeline-ruler');
      fireEvent.keyDown(ruler!, { key: 'ArrowRight' });
      expect(onSeek).toHaveBeenCalledWith(5000);
    });
  });

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
