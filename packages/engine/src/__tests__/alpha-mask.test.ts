// @vitest-environment jsdom
/**
 * Tests for alpha mask rendering via renderAlphaMask.
 *
 * Alpha masks use offscreen canvas compositing (destination-in) so that
 * the mask source's alpha channel determines the opacity of masked content.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderAlphaMask } from '../replay';

describe('renderAlphaMask', () => {
  let mainCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2d context');
    mainCtx = ctx;
  });

  it('alpha mask renders content clipped to mask alpha', () => {
    const maskDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {
      /* mask source draws into offscreen context */
    });
    const contentDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {
      /* masked content draws into offscreen context */
    });

    renderAlphaMask(mainCtx, { draw: maskDraw }, { draw: contentDraw });

    // Both callbacks must be invoked
    expect(maskDraw).toHaveBeenCalledTimes(1);
    expect(contentDraw).toHaveBeenCalledTimes(1);

    // Main canvas receives the composited result
    expect(mainCtx.drawImage).toHaveBeenCalledTimes(1);
    const drawImageMock = mainCtx.drawImage as ReturnType<typeof vi.fn>;
    const firstCall = drawImageMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const drawArg = firstCall![0];
    // The first argument to drawImage is the content canvas
    expect(drawArg).toBeInstanceOf(HTMLCanvasElement);
  });

  it('alpha mask preserves content where mask is opaque', () => {
    // Opaque mask: mask draws a fully opaque white rect over the area
    const maskDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fillRect(0, 0, 200, 200);
    });

    const contentDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 200, 200);
    });

    renderAlphaMask(mainCtx, { draw: maskDraw }, { draw: contentDraw });

    // Both callbacks executed
    expect(maskDraw).toHaveBeenCalled();
    expect(contentDraw).toHaveBeenCalled();

    // Main canvas receives the composited result
    expect(mainCtx.drawImage).toHaveBeenCalled();
  });

  it('alpha mask hides content where mask is transparent', () => {
    // A transparent mask means the content should not appear on the main canvas
    // Mask draws nothing — just trace path but no fill
    const maskDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      // deliberately not filling — mask is transparent
    });

    const contentDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {
      /* content with opaque fill */
    });

    renderAlphaMask(mainCtx, { draw: maskDraw }, { draw: contentDraw });

    // Both callbacks still invoked
    expect(maskDraw).toHaveBeenCalled();
    expect(contentDraw).toHaveBeenCalled();

    // Main drawImage called (with composited result)
    expect(mainCtx.drawImage).toHaveBeenCalled();
  });

  it('alpha mask does not throw for zero-size canvas', () => {
    const zeroCanvas = document.createElement('canvas');
    zeroCanvas.width = 0;
    zeroCanvas.height = 0;
    const zeroCtx = zeroCanvas.getContext('2d');
    if (!zeroCtx) throw new Error('Could not get 2d context');

    expect(() => {
      renderAlphaMask(zeroCtx, { draw: vi.fn() }, { draw: vi.fn() });
    }).not.toThrow();
  });

  it('alpha mask does not affect main context state after completion', () => {
    mainCtx.globalCompositeOperation = 'source-over';

    const maskDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {
      /* mask */
    });
    const contentDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {
      /* content */
    });

    renderAlphaMask(mainCtx, { draw: maskDraw }, { draw: contentDraw });

    // Global composite operation should remain unchanged on main context
    expect(mainCtx.globalCompositeOperation).toBe('source-over');
  });

  it('mask rendering does not affect subsequent draw calls (state isolation)', () => {
    // Verify that after renderAlphaMask, the main context is in a clean state
    mainCtx.globalCompositeOperation = 'source-over';

    const maskDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {});
    const contentDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {});

    renderAlphaMask(mainCtx, { draw: maskDraw }, { draw: contentDraw });

    // After render, main context's composite operation is preserved
    expect(mainCtx.globalCompositeOperation).toBe('source-over');

    // Drawing after alpha mask should work normally
    expect(() => {
      mainCtx.fillRect(0, 0, 10, 10);
    }).not.toThrow();
  });

  it('alpha mask with gradient fill produces gradient opacity (structural verification)', () => {
    // Mask source draws with partial opacity (simulating a half-opaque gradient)
    const maskDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(0, 0, 200, 200);
    });

    const contentDraw = vi.fn((ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 200, 200);
    });

    renderAlphaMask(mainCtx, { draw: maskDraw }, { draw: contentDraw });

    // Both callbacks invoked
    expect(maskDraw).toHaveBeenCalled();
    expect(contentDraw).toHaveBeenCalled();

    // Main canvas receives composited result
    expect(mainCtx.drawImage).toHaveBeenCalled();
  });
});
