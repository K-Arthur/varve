import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Ruler } from './Ruler';

function mockRect(
  el: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => rect,
    }),
  });
}

describe('Ruler guide creation', () => {
  it('creates one vertical guide and moves that same guide during a top-ruler drag', () => {
    const onAddGuide = vi.fn(() => 'guide-1');
    const onMoveGuide = vi.fn();
    const { container } = render(
      <Ruler
        zoom={1}
        pan={{ x: 0, y: 0 }}
        unitType="px"
        onAddGuide={onAddGuide}
        onMoveGuide={onMoveGuide}
        canvasWidth={800}
        canvasHeight={600}
      />,
    );

    const topRuler = container.querySelector('.ruler-canvas--top');
    expect(topRuler).toBeInstanceOf(HTMLCanvasElement);
    mockRect(topRuler!, { left: 20, top: 0, width: 800, height: 20 });

    fireEvent.mouseDown(topRuler!, { button: 0, clientX: 120, clientY: 8 });
    fireEvent.mouseMove(window, { clientX: 180, clientY: 8 });
    fireEvent.mouseMove(window, { clientX: 240, clientY: 8 });
    fireEvent.mouseUp(window);

    expect(onAddGuide).toHaveBeenCalledTimes(1);
    expect(onAddGuide).toHaveBeenCalledWith('vertical', 100);
    expect(onMoveGuide).toHaveBeenNthCalledWith(1, 'guide-1', 160);
    expect(onMoveGuide).toHaveBeenNthCalledWith(2, 'guide-1', 220);
  });

  it('creates one horizontal guide and moves that same guide during a left-ruler drag', () => {
    const onAddGuide = vi.fn(() => 'guide-2');
    const onMoveGuide = vi.fn();
    const { container } = render(
      <Ruler
        zoom={2}
        pan={{ x: 0, y: 0 }}
        unitType="px"
        onAddGuide={onAddGuide}
        onMoveGuide={onMoveGuide}
        canvasWidth={800}
        canvasHeight={600}
      />,
    );

    const leftRuler = container.querySelector('.ruler-canvas--left');
    expect(leftRuler).toBeInstanceOf(HTMLCanvasElement);
    mockRect(leftRuler!, { left: 0, top: 20, width: 20, height: 600 });

    fireEvent.mouseDown(leftRuler!, { button: 0, clientX: 8, clientY: 120 });
    fireEvent.mouseMove(window, { clientX: 8, clientY: 160 });
    fireEvent.mouseUp(window);

    expect(onAddGuide).toHaveBeenCalledTimes(1);
    expect(onAddGuide).toHaveBeenCalledWith('horizontal', 50);
    expect(onMoveGuide).toHaveBeenCalledOnce();
    expect(onMoveGuide).toHaveBeenCalledWith('guide-2', 70);
  });
});
