/**
 * Icon export — format-specific icon export utilities.
 */

export type IconExportFormat =
  | 'svg'
  | 'react'
  | 'vue'
  | 'svelte'
  | 'flutter'
  | 'css'
  | 'html'
  | 'json';

export interface IconExportOptions {
  format: IconExportFormat;
  size?: number;
  viewBox?: string;
  strokeWidth?: number;
  fill?: string;
  stroke?: string;
  useCurrentColor?: boolean;
  precision?: number;
  minify?: boolean;
  componentName?: string;
  includeTitle?: boolean;
  title?: string;
}

const DEFAULT_VIEWBOX = '0 0 24 24';
const DEFAULT_SIZE = 24;

export function exportIcon(svg: string, name: string, options: IconExportOptions): string {
  const { format } = options;
  switch (format) {
    case 'svg':
      return exportSvg(svg, name, options);
    case 'react':
      return exportReact(svg, name, options);
    case 'vue':
      return exportVue(svg, name, options);
    case 'svelte':
      return exportSvelte(svg, name, options);
    case 'flutter':
      return exportFlutter(svg, name, options);
    case 'css':
      return exportCss(svg, name, options);
    case 'html':
      return exportHtml(svg, name, options);
    case 'json':
      return exportJson(svg, name, options);
    default:
      return svg;
  }
}

function toPascalCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());
}

function extractViewBox(svg: string): string | null {
  const match = svg.match(/viewBox=["']([^"']+)["']/);
  return match?.[1] ?? null;
}

function extractInnerSvg(svg: string): string {
  const inner = svg.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '');
  return inner.trim();
}

function escapeForAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function applyOverrides(innerSvg: string, options: IconExportOptions): string {
  let result = innerSvg;
  if (options.useCurrentColor) {
    result = result.replace(/fill="(?!none)[^"]*"/g, 'fill="currentColor"');
    result = result.replace(/stroke="(?!none)[^"]*"/g, 'stroke="currentColor"');
    result = result.replace(/style="[^"]*"/g, (m) =>
      m
        .replace(/fill:\s*[^;"]+/g, 'fill: currentColor')
        .replace(/stroke:\s*[^;"]+/g, 'stroke: currentColor'),
    );
  }
  if (options.fill) {
    result = result.replace(/fill="[^"]*"/g, `fill="${options.fill}"`);
  }
  if (options.stroke) {
    result = result.replace(/stroke="[^"]*"/g, `stroke="${options.stroke}"`);
  }
  if (options.strokeWidth !== undefined) {
    result = result.replace(/stroke-width="[^"]*"/g, `stroke-width="${options.strokeWidth}"`);
  }
  return result;
}

function exportSvg(svg: string, _name: string, options: IconExportOptions): string {
  const size = options.size ?? DEFAULT_SIZE;
  const viewBox = options.viewBox ?? extractViewBox(svg) ?? DEFAULT_VIEWBOX;
  const inner = applyOverrides(extractInnerSvg(svg), options);
  const title = options.includeTitle && options.title ? `<title>${options.title}</title>` : '';
  const result = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}">${title}${inner}</svg>`;
  if (options.minify) {
    return result
      .replace(/\n/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return result;
}

function exportReact(svg: string, name: string, options: IconExportOptions): string {
  const componentName = options.componentName ?? toPascalCase(name);
  const viewBox = options.viewBox ?? extractViewBox(svg) ?? DEFAULT_VIEWBOX;
  const size = options.size ?? DEFAULT_SIZE;
  const inner = applyOverrides(extractInnerSvg(svg), options);
  const title =
    options.includeTitle && options.title
      ? `<title>{label || '${escapeForAttr(options.title)}'}</title>`
      : '';

  return `import type { SVGProps } from 'react';

export interface ${componentName}Props extends SVGProps<SVGSVGElement> {
  size?: number;
  label?: string;
}

export function ${componentName}({ size = ${size}, label, ...props }: ${componentName}Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="${viewBox}"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={!label}
      {...props}
    >
      ${title}${inner}
    </svg>
  );
}`;
}

function exportVue(svg: string, _name: string, options: IconExportOptions): string {
  const viewBox = options.viewBox ?? extractViewBox(svg) ?? DEFAULT_VIEWBOX;
  const inner = applyOverrides(extractInnerSvg(svg), options);
  const title =
    options.includeTitle && options.title
      ? `<title>{{ label || '${escapeForAttr(options.title)}' }}</title>`
      : '';

  return `<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="${viewBox}"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="!label"
  >
    ${title}${inner}
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  size?: number;
  label?: string;
}>();
</script>`;
}

function exportSvelte(svg: string, _name: string, options: IconExportOptions): string {
  const viewBox = options.viewBox ?? extractViewBox(svg) ?? DEFAULT_VIEWBOX;
  const size = options.size ?? DEFAULT_SIZE;
  const inner = applyOverrides(extractInnerSvg(svg), options);
  const title =
    options.includeTitle && options.title
      ? `<title>{label || '${escapeForAttr(options.title)}'}</title>`
      : '';

  return `<script lang="ts">
  export let size: number = ${size};
  export let label: string | undefined = undefined;
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="${viewBox}"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={!label}
>
  ${title}${inner}
</svg>`;
}

function exportFlutter(svg: string, name: string, options: IconExportOptions): string {
  const componentName = `${toPascalCase(name)}Icon`;
  const size = options.size ?? DEFAULT_SIZE;
  const escapedSvg = svg.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

  return `import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

class ${componentName} extends StatelessWidget {
  final double size;

  const ${componentName}({super.key, this.size = ${size}.0});

  @override
  Widget build(BuildContext context) {
    return SvgPicture.string(
      '${escapedSvg}',
      width: size,
      height: size,
    );
  }
}`;
}

function exportCss(svg: string, name: string, options: IconExportOptions): string {
  const size = options.size ?? DEFAULT_SIZE;
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
  return `.icon-${name} {
  display: inline-block;
  width: ${size}px;
  height: ${size}px;
  background-image: url("data:image/svg+xml,${encoded}");
  background-repeat: no-repeat;
  background-size: contain;
}`;
}

function exportHtml(svg: string, name: string, options: IconExportOptions): string {
  const inner = applyOverrides(extractInnerSvg(svg), options);
  return `<span role="img" aria-label="${escapeForAttr(name)}">${inner}</span>`;
}

function exportJson(svg: string, name: string, options: IconExportOptions): string {
  const viewBox = options.viewBox ?? extractViewBox(svg) ?? DEFAULT_VIEWBOX;
  const size = options.size ?? DEFAULT_SIZE;
  const obj = {
    name,
    viewBox,
    size,
    svg: extractInnerSvg(svg),
  };
  return JSON.stringify(obj, null, 2);
}
