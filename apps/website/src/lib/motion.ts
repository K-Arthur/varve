/**
 * Website motion system — shared primitives.
 *
 * The site's motion is layered on CSS transitions + Web Animations API +
 * IntersectionObserver, driven from a small number of helpers here. Rules:
 *
 *  - Everything decorative must collapse under `prefers-reduced-motion`.
 *  - `?test-motion=static` sets `data-motion="static"` on <html> so E2E
 *    snapshots are deterministic without relying on the media query.
 *  - Content never depends on animation: hidden initial states are only
 *    ever applied when motion is allowed.
 */

/** True when decorative/scroll-triggered motion is allowed. */
export function prefersMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.dataset.motion === 'static') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** True on coarse pointers (touch/tablets) where hover-driven FX is useless. */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/** Deterministic mulberry32 PRNG — same seed, same field, every visit. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ease-out cubic, used for pointer-follow motion. */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * One shared IntersectionObserver for `[data-reveal]` elements across the
 * site. Registering once here means no page can spawn competing observers.
 */
let revealObserver: IntersectionObserver | null = null;

export function initReveals(): void {
  // Tells the pre-paint safety timer (Layout.astro) that the observer is in
  // charge, so it does not force everything visible behind our back.
  document.documentElement.dataset.revealReady = 'true';

  if (typeof IntersectionObserver === 'undefined') {
    // Ancient engines: reveal everything immediately.
    for (const el of document.querySelectorAll('[data-reveal]')) {
      el.classList.add('revealed');
    }
    return;
  }
  if (revealObserver) return;
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          revealObserver!.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -5% 0px' },
  );
  for (const el of document.querySelectorAll('[data-reveal]')) {
    if (el instanceof HTMLElement) {
      const raw = el.dataset.revealDelay;
      if (raw) el.style.transitionDelay = `${raw}ms`;
    }
    revealObserver.observe(el);
  }
}
