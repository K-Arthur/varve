import { describe, expect, it } from 'vitest';
import {
  applyCurrentColor,
  isSvgSafe,
  normalizeViewBox,
  rewriteSvgIds,
  SanitizeError,
  sanitizeSvg,
} from './svgSanitize';

describe('sanitizeSvg', () => {
  it('passes through a clean SVG unchanged', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z" fill="currentColor"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).toContain('<path');
    expect(result.svg).toContain('currentColor');
    expect(result.modified).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('removes <script> elements', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <script>alert('xss')</script>
      <path d="M12 2L2 22h20L12 2z" fill="currentColor"/>
    </svg>`;
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('<script>');
    expect(result.modified).toBe(true);
    expect(result.warnings.some((w) => w.code === 'removed-dangerous-tag')).toBe(true);
  });

  it('removes event handler attributes', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z" fill="currentColor" onclick="alert(1)" onload="alert(2)"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('onclick');
    expect(result.svg).not.toContain('onload');
    expect(result.modified).toBe(true);
  });

  it('removes foreignObject elements', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><foreignObject><div>evil</div></foreignObject><path d="M12 2L2 22h20L12 2z"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('foreignObject');
    expect(result.modified).toBe(true);
  });

  it('removes javascript: URLs', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><a href="javascript:alert(1)"><path d="M12 2L2 22h20L12 2z"/></a></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('javascript:');
    expect(result.modified).toBe(true);
  });

  it('removes external image references', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><image href="https://evil.com/tracker.png"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('evil.com');
    expect(result.modified).toBe(true);
  });

  it('removes <style> elements', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>svg { background: url(evil.com) }</style><path d="M12 2"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('<style>');
    expect(result.modified).toBe(true);
  });

  it('preserves allowed attributes', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path d="M12 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd" opacity="0.5" transform="translate(1 1)"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).toContain('stroke="currentColor"');
    expect(result.svg).toContain('stroke-width="2"');
    expect(result.svg).toContain('stroke-linecap="round"');
    expect(result.svg).toContain('transform="translate(1 1)"');
  });

  it('throws on empty input', () => {
    expect(() => sanitizeSvg('')).toThrow(SanitizeError);
    expect(() => sanitizeSvg('   ')).toThrow(SanitizeError);
  });

  it('throws on malformed XML', () => {
    expect(() => sanitizeSvg('not an svg')).toThrow(SanitizeError);
  });

  it('enforces max nesting depth', () => {
    const deepSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<g>'.repeat(50) +
      '<path d="M12 2"/>' +
      '</g>'.repeat(50) +
      '</svg>';
    const result = sanitizeSvg(deepSvg, { maxNestingDepth: 10 });
    expect(result.warnings.some((w) => w.code === 'nesting-depth-limit')).toBe(true);
  });

  it('enforces path command limits', () => {
    const longPath = `M0 0${' L1 1'.repeat(5000)}`;
    const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${longPath}"/></svg>`;
    const result = sanitizeSvg(input, { maxPathCommands: 100 });
    expect(result.warnings.some((w) => w.code === 'path-command-limit')).toBe(true);
  });

  it('removes data:text/html URLs', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><a href="data:text/html,<script>alert(1)</script>"><path d="M12 2"/></a></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('data:text/html');
  });

  it('removes vbscript: URLs', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><a href="vbscript:msgbox"><path d="M12 2"/></a></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('vbscript:');
  });

  it('keeps gradient elements when allowed', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <defs>
        <linearGradient id="g1">
          <stop offset="0%" stop-color="currentColor"/>
          <stop offset="100%" stop-color="currentColor"/>
        </linearGradient>
      </defs>
      <rect width="24" height="24" fill="url(#g1)"/>
    </svg>`;
    const result = sanitizeSvg(input, { allowGradients: true });
    expect(result.svg).toContain('<linearGradient');
    expect(result.svg).toContain('<stop');
  });

  it('removes gradient elements when disallowed', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <defs>
        <linearGradient id="g1">
          <stop offset="0%" stop-color="red"/>
          <stop offset="100%" stop-color="blue"/>
        </linearGradient>
      </defs>
      <rect width="24" height="24" fill="url(#g1)"/>
    </svg>`;
    const result = sanitizeSvg(input, { allowGradients: false });
    expect(result.svg).not.toContain('<linearGradient');
  });

  it('keeps <use> references when allowed', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <defs><path id="p1" d="M12 2"/></defs>
      <use href="#p1"/>
    </svg>`;
    const result = sanitizeSvg(input, { allowUse: true });
    expect(result.svg).toContain('<use');
  });

  it('removes <use> with external href', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <use href="https://evil.com/icon.svg#fragment"/>
    </svg>`;
    const result = sanitizeSvg(input, { allowUse: true });
    expect(result.svg).not.toContain('evil.com');
  });
});

describe('isSvgSafe', () => {
  it('returns true for clean SVG', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2" fill="currentColor"/></svg>';
    expect(isSvgSafe(input)).toBe(true);
  });

  it('returns false for SVG with script', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><path d="M12 2"/></svg>';
    expect(isSvgSafe(input)).toBe(false);
  });

  it('returns false for malformed SVG', () => {
    expect(isSvgSafe('not an svg')).toBe(false);
  });
});

describe('normalizeViewBox', () => {
  it('adds viewBox if missing', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M12 2"/></svg>';
    const result = normalizeViewBox(input);
    expect(result.svg).toContain('viewBox="0 0 24 24"');
  });

  it('uses custom size', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M12 2"/></svg>';
    const result = normalizeViewBox(input, 32);
    expect(result.svg).toContain('viewBox="0 0 32 32"');
  });
});

describe('applyCurrentColor', () => {
  it('converts fill colors to currentColor', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2" fill="red"/></svg>';
    const result = applyCurrentColor(input);
    expect(result.svg).toContain('fill="currentColor"');
    expect(result.svg).not.toContain('fill="red"');
  });

  it('preserves fill="none"', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2" fill="none"/></svg>';
    const result = applyCurrentColor(input);
    expect(result.svg).toContain('fill="none"');
  });

  it('converts stroke colors to currentColor', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2" stroke="blue" fill="none"/></svg>';
    const result = applyCurrentColor(input);
    expect(result.svg).toContain('stroke="currentColor"');
  });
});

describe('sanitizeSvg hardening', () => {
  it('rejects input larger than the size limit', () => {
    const huge = `<svg xmlns="http://www.w3.org/2000/svg">${'<g/>'.repeat(400000)}</svg>`;
    let code = '';
    try {
      sanitizeSvg(huge);
    } catch (err) {
      code = err instanceof SanitizeError ? err.code : '';
    }
    expect(code).toBe('input-too-large');
  });

  it('strips external url() references from clip-path and mask', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" clip-path="url(https://evil.com/defs#clip)"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('evil.com');
  });

  it('strips data: URLs from fill and stroke paint servers', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="url(data:image/png;base64,AAAA)"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('data:');
  });

  it('removes dangerous and unknown inline style declarations', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="position:fixed;fill:red;-moz-binding:url(x);background:url(https://evil.com/x.png)"><path d="M0 0"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('position');
    expect(result.svg).not.toContain('-moz-binding');
    expect(result.svg).not.toContain('evil.com');
    expect(result.svg).toContain('fill:red');
  });

  it('removes recursive <use> reference cycles', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><symbol id="a"><use href="#b"/></symbol><symbol id="b"><use href="#a"/></symbol></defs><use href="#a"/></svg>';
    const result = sanitizeSvg(input);
    const cycles = result.warnings.filter((w) => w.code === 'removed-use-cycle');
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('removes non-finite numbers from geometry attributes', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="NaN" y="Infinity" width="24" height="24"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('NaN');
    expect(result.svg).not.toContain('Infinity');
  });

  it('rejects invalid viewBox values', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 NaN 24"><path d="M0 0"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).not.toContain('viewBox=');
    expect(result.warnings.some((w) => w.code === 'removed-non-finite-number')).toBe(true);
  });

  it('keeps percentage gradient stops', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><linearGradient id="g"><stop offset="50%" stop-color="red"/></linearGradient></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).toContain('offset="50%"');
  });

  it('allows built-in filter functions and strips exotic ones', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0" style="filter:blur(2px)"/><path d="M1 1" style="filter:url(https://evil.com/#f)"/></svg>';
    const result = sanitizeSvg(input);
    expect(result.svg).toContain('blur');
    expect(result.svg).not.toContain('evil.com');
  });
});

describe('rewriteSvgIds', () => {
  it('rewrites ids and fragment references with a stable prefix', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g1"><stop offset="0" stop-color="red"/></linearGradient><path id="p1" d="M0 0"/></defs><use href="#p1"/><rect fill="url(#g1)" width="4" height="4"/></svg>';
    const result = rewriteSvgIds(input, 'icon-abc');
    expect(result.svg).toContain('id="icon-abc-1-g1"');
    expect(result.svg).toContain('url(#icon-abc-1-g1)');
    expect(result.svg).toContain('href="#icon-abc-2-p1"');
    expect(result.svg).not.toContain('id="g1"');
  });

  it('is deterministic for the same input', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><path id="p1" d="M0 0"/></defs><use href="#p1"/></svg>';
    const a = rewriteSvgIds(input, 'i').svg;
    const b = rewriteSvgIds(input, 'i').svg;
    expect(a).toBe(b);
  });
});
