import { describe, expect, it } from 'vitest';
import { auditIconCollection, auditIconSvg } from './iconAudit';

describe('auditIconSvg', () => {
  it('returns clean for a valid SVG', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const result = auditIconSvg(svg);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it('warns about missing viewBox', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M12 2" fill="none" stroke="currentColor"/></svg>';
    const result = auditIconSvg(svg);
    expect(result.findings.some((f) => f.message.includes('Missing viewBox'))).toBe(true);
  });

  it('errors on script elements', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script></svg>';
    const result = auditIconSvg(svg);
    expect(result.passed).toBe(false);
  });

  it('errors on event handlers', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2" onclick="alert(1)"/></svg>';
    const result = auditIconSvg(svg);
    expect(result.passed).toBe(false);
  });

  it('errors on foreignObject', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><foreignObject><div>test</div></foreignObject></svg>';
    const result = auditIconSvg(svg);
    expect(result.passed).toBe(false);
  });

  it('warns about multiple stroke widths', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2" stroke-width="2"/><path d="M12 2" stroke-width="1.5"/></svg>';
    const result = auditIconSvg(svg);
    expect(result.findings.some((f) => f.message.includes('Multiple stroke widths'))).toBe(true);
  });

  it('warns about high path count', () => {
    const paths = Array.from({ length: 150 }, (_, i) => `<path d="M${i} 0"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${paths}</svg>`;
    const result = auditIconSvg(svg);
    expect(result.findings.some((f) => f.message.includes('High path count'))).toBe(true);
  });

  it('errors on empty input', () => {
    const result = auditIconSvg('');
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it('detects non-square viewBox', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><path d="M12 2" fill="none" stroke="currentColor"/></svg>';
    const result = auditIconSvg(svg);
    expect(result.findings.some((f) => f.message.includes('Non-square viewBox'))).toBe(true);
  });

  it('notes presence of title element', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Home icon</title><path d="M12 2" fill="none" stroke="currentColor"/></svg>';
    const result = auditIconSvg(svg);
    expect(result.findings.some((f) => f.message.includes('<title>'))).toBe(true);
  });
});

describe('auditIconCollection', () => {
  it('returns correct counts for a mixed collection', () => {
    const icons = [
      {
        id: 'a',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2" fill="none" stroke="currentColor"/></svg>',
      },
      {
        id: 'b',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script></svg>',
      },
    ];
    const result = auditIconCollection(icons);
    expect(result.totalIcons).toBe(2);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.bySeverity.error).toBeGreaterThan(0);
  });
});
