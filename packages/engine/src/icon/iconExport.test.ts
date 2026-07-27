import { describe, expect, it } from 'vitest';
import { exportIcon } from './iconExport';

const TEST_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

describe('exportIcon', () => {
  it('exports as SVG', () => {
    const result = exportIcon(TEST_SVG, 'test-icon', { format: 'svg' });
    expect(result).toContain('viewBox="0 0 24 24"');
    expect(result).toContain('<path');
  });

  it('exports SVG with custom size', () => {
    const result = exportIcon(TEST_SVG, 'test', { format: 'svg', size: 32 });
    expect(result).toContain('width="32"');
    expect(result).toContain('height="32"');
  });

  it('exports SVG with currentColor', () => {
    const result = exportIcon(TEST_SVG, 'test', { format: 'svg', useCurrentColor: true });
    expect(result).toContain('fill="none"');
    expect(result).toContain('stroke="currentColor"');
  });

  it('exports SVG with title', () => {
    const result = exportIcon(TEST_SVG, 'test', {
      format: 'svg',
      includeTitle: true,
      title: 'My Icon',
    });
    expect(result).toContain('<title>My Icon</title>');
  });

  it('exports SVG minified', () => {
    const result = exportIcon(TEST_SVG, 'test', { format: 'svg', minify: true });
    expect(result).not.toContain('\n');
  });

  it('exports as React component', () => {
    const result = exportIcon(TEST_SVG, 'my-icon', { format: 'react' });
    expect(result).toContain('export function MyIcon');
    expect(result).toContain('SVGProps<SVGSVGElement>');
    expect(result).toContain("role={label ? 'img' : undefined}");
    expect(result).toContain('aria-hidden');
  });

  it('exports as Vue component', () => {
    const result = exportIcon(TEST_SVG, 'my-icon', { format: 'vue' });
    expect(result).toContain('<template>');
    expect(result).toContain('<script setup');
  });

  it('exports as Svelte component', () => {
    const result = exportIcon(TEST_SVG, 'my-icon', { format: 'svelte' });
    expect(result).toContain('export let size');
    expect(result).toContain('aria-hidden');
  });

  it('exports as Flutter widget', () => {
    const result = exportIcon(TEST_SVG, 'my-icon', { format: 'flutter' });
    expect(result).toContain('class MyIconIcon extends StatelessWidget');
    expect(result).toContain('SvgPicture.string');
  });

  it('exports as CSS', () => {
    const result = exportIcon(TEST_SVG, 'my-icon', { format: 'css' });
    expect(result).toContain('.icon-my-icon');
    expect(result).toContain('background-image');
    expect(result).toContain('data:image/svg+xml');
  });

  it('exports as HTML', () => {
    const result = exportIcon(TEST_SVG, 'my-icon', { format: 'html' });
    expect(result).toContain('role="img"');
    expect(result).toContain('aria-label="my-icon"');
  });

  it('exports as JSON', () => {
    const result = exportIcon(TEST_SVG, 'my-icon', { format: 'json' });
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe('my-icon');
    expect(parsed.svg).toContain('<path');
    expect(parsed.size).toBe(24);
  });
});
