/** Canvas backing-store sizing and display-scale lifecycle helpers. */

export function canvasBackingSize(cssSize: number, dpr: number): number {
  if (!Number.isFinite(cssSize) || !Number.isFinite(dpr) || cssSize <= 0 || dpr <= 0) return 0;
  return Math.max(1, Math.round(cssSize * dpr));
}

export function resizeCanvasBackingStore(
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): boolean {
  const width = canvasBackingSize(cssWidth, dpr);
  const height = canvasBackingSize(cssHeight, dpr);
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

export function subscribeToDevicePixelRatio(
  onChange: (dpr: number) => void,
  target: Window = window,
): () => void {
  let query: MediaQueryList | null = null;
  const createQuery = target.matchMedia?.bind(target);
  const handleChange = (): void => {
    query?.removeEventListener('change', handleChange);
    const dpr = target.devicePixelRatio || 1;
    query = createQuery?.(`(resolution: ${dpr}dppx)`) ?? null;
    query?.addEventListener('change', handleChange);
    onChange(dpr);
  };
  target.addEventListener('resize', handleChange);
  handleChange();
  return () => {
    target.removeEventListener('resize', handleChange);
    query?.removeEventListener('change', handleChange);
  };
}

export function subscribeToCanvasContextLifecycle(
  canvas: HTMLCanvasElement,
  handlers: { onLost: () => void; onRestored: () => void },
): () => void {
  const onLost = (event: Event): void => {
    event.preventDefault();
    handlers.onLost();
  };
  const onRestored = (): void => handlers.onRestored();
  canvas.addEventListener('contextlost', onLost);
  canvas.addEventListener('contextrestored', onRestored);
  return () => {
    canvas.removeEventListener('contextlost', onLost);
    canvas.removeEventListener('contextrestored', onRestored);
  };
}
