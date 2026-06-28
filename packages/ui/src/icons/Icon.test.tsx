import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { CHROME_ICONS, TOOL_ICONS } from './index';

describe('<Icon>', () => {
  it('renders an svg', () => {
    const markup = renderToStaticMarkup(<Icon name="Square" label="Rectangle" />);
    expect(markup).toMatch(/^<svg/i);
    expect(markup).toContain('</svg>');
  });

  it('exposes role=img + aria-label when given a label', () => {
    const markup = renderToStaticMarkup(<Icon name="Pen" label="Pen tool" />);
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Pen tool"');
  });

  it('hides from AT when decorative (no label)', () => {
    const markup = renderToStaticMarkup(<Icon name="Check" />);
    expect(markup).toContain('aria-hidden="true"');
  });

  it('uses currentColor so it tracks token text color', () => {
    const markup = renderToStaticMarkup(<Icon name="Square" />);
    expect(markup).toContain('stroke="currentColor"');
  });

  it('all TOOL_ICONS values are valid Lucide names', () => {
    for (const [key, name] of Object.entries(TOOL_ICONS)) {
      expect(() => renderToStaticMarkup(<Icon name={name} label={key} />)).not.toThrow();
    }
  });

  it('all CHROME_ICONS values are valid Lucide names', () => {
    for (const [key, name] of Object.entries(CHROME_ICONS)) {
      expect(() => renderToStaticMarkup(<Icon name={name} label={key} />)).not.toThrow();
    }
  });
});
