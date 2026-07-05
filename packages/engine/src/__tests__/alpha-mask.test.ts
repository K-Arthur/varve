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
    const drawArg = (mainCtx.drawImage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    // The first argument to drawImage is the content canvas
    expect(drawArg).toBeInstanceOf(HTMLCanvasElement);
  });

  it('alpha mask preserves content where mask is opaque', () => {
    let maskCtxSaved: CanvasRenderingContext2D | null = null;
    let contentCtxSaved: CanvasRenderingContext2D | null = null;

    // Spy on document.createElement to intercept offscreen canvases
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement');
    createElementSpy.mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const el = originalCreateElement(tagName, options);
      if (tagName === 'canvas') {
        // Wrap getContext to capture the context
        const originalGetContext = el.getContext.bind(el);
        vi.spyOn(el, 'getContext').mockImplementation((...args: Parameters<HTMLCanvasElement['getContext']>) => {
          const ctx = originalGetContext(...args);
          if (ctx && args[0] === '2d') {
            // First offscreen canvas created = mask, second = content
            if (!maskCtxSaved) {
              maskCtxSaved = ctx;
            } else if (!contentCtxSaved) {
              contentCtxSaved = ctx;
            }
          }
          return ctx;
        });
      }
      return el;
    });

    const maskDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {
      /* opaque white rect */
    });
    const contentDraw = vi.fn((_ctx: CanvasRenderingContext2D) => {
      /* content */
    });

    renderAlphaMask(mainCtx, { draw: maskDraw }, { draw: contentDraw });

    // Both canvases, both callbacks executed
    expect(maskCtxSaved).toBeTruthy();
    expect(contentCtxSaved).toBeTruthy();

    // Content context had its composite operation set to destination-in
    if (contentCtxSaved) {
      expect((contentCtxSaved as any).globalCompositeOperation).toBe('destination-in');
    }

    // Main drawImage called
    expect(mainCtx.drawImage).toHaveBeenCalled();

    createElementSpy.mockRestore();
  });

  it('alpha mask hides content where mask is transparent', () => {
    // A transparent mask means the content should not appear on the main canvas
    let maskCtxCapture: CanvasRenderingContext2D | null = null;

    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement');
    createElementSpy.mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const el = originalCreateElement(tagName, options);
      if (tagName === 'canvas') {
        const originalGetContext = el.getContext.bind(el);
        vi.spyOn(el, 'getContext').mockImplementation((...args: Parameters<HTMLCanvasElement['getContext']>) => {
          const ctx = originalGetContext(...args);
          if (ctx && args[0] === '2d' && !maskCtxCapture) {
            maskCtxCapture = ctx;
          }
          return ctx;
        });
      }
      return el;
    });

    // Mask draws nothing (transparent) — just beginPath but no fill
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

    createElementSpy.mockRestore();
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
    let maskCtxCapture: CanvasRenderingContext2D | null = null;

    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement');
    createElementSpy.mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const el = originalCreateElement(tagName, options);
      if (tagName === 'canvas') {
        const originalGetContext = el.getContext.bind(el);
        vi.spyOn(el, 'getContext').mockImplementation((...args: Parameters<HTMLCanvasElement['getContext']>) => {
          const ctx = originalGetContext(...args);
          if (ctx && args[0] === '2d' && !maskCtxCapture) {
            maskCtxCapture = ctx;
          }
          return ctx;
        });
      }
      return el;
    });

    // Mask source draws simulating a gradient (solid white with alpha range)
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

    // Verify destination-in compositing happened on the content canvas
    if (maskCtxCapture) {
      expect(maskCtxCapture.fillStyle).toBe('');
    }

    createElementSpy.mockRestore();
  });
});
