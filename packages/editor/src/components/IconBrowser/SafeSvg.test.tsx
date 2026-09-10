/**
 * SafeSvg — rendering contract tests.
 *
 * The critical regression this guards: SVG geometry only draws when its
 * elements live in the SVG namespace, which requires a real <svg> root.
 * Injecting just the inner <path>/<title> markup into a plain span parses
 * them as HTML elements (HTMLUnknownElement) and nothing renders — the icon
 * browser showed empty skeletons even though the data pipeline worked.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SafeSvg } from './SafeSvg';

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
  '<title>eye</title>' +
  '<path fill="currentColor" d="M12 9a3 3 0 0 0-3 3" />' +
  '</svg>';

describe('SafeSvg', () => {
  it('renders the SVG root so paths parse into the SVG namespace', () => {
    const { container } = render(<SafeSvg svg={ICON_SVG} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const path = svg?.querySelector('path');
    expect(path).not.toBeNull();
    // SVG namespace is the precondition for any of this geometry drawing.
    expect(path?.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('keeps the root attributes (viewBox) intact', () => {
    const { container } = render(<SafeSvg svg={ICON_SVG} />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('renders a rejected marker when sanitization fails', () => {
    const { container } = render(<SafeSvg svg="<script>alert(1)</script>" />);
    expect(container.querySelector('[data-safe-svg="rejected"]')).not.toBeNull();
  });

  it('can render as an <img> data URL', () => {
    const { container } = render(<SafeSvg svg={ICON_SVG} asImage />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.src.startsWith('data:image/svg+xml')).toBe(true);
  });
});
