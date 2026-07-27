import { describe, expect, it } from 'vitest';
import {
  applyCurrentColor,
  isSvgSafe,
  normalizeViewBox,
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
