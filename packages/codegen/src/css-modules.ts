/**
 * React + CSS Modules target emitter.
 *
 * Produces a real pair of files — `<stem>.tsx` and `<stem>.module.css` — with
 * matching safe imports, one class per node in the selected subtree, and the
 * component's children preserved.
 *
 * Research basis: css-modules/css-modules (locally-scoped class names),
 * React DOM common components (a JSX expression container escapes its own
 * contents, so design text must be encoded exactly once).
 */

import type { Document as SceneDocument, SceneNode } from '@varve/scene';
import { type CssExportOptions, collectCssRules, cssTargetGaps } from './css';
import { styleKeyAccess, toComponentName, toFileStem } from './naming';
import { unstableImageSourceReason } from './shared';
import {
  type BundleDiagnostic,
  type GeneratedBundle,
  type GeneratedFile,
  mimeTypeForLanguage,
  type TargetGap,
} from './types';

export interface CssModulesExportOptions extends CssExportOptions {
  /** Component name. Default: PascalCase of the node name. */
  componentName?: string;
  /** File stem for the emitted pair. Default: kebab-case of the node name. */
  fileStem?: string;
  /** Directory prefix for emitted paths. Default: '' (files sit together). */
  directory?: string;
}

type Rules = ReturnType<typeof collectCssRules>;
type Rule = Rules[number];

interface EmittedPair {
  rules: Rules;
  componentName: string;
  fileStem: string;
}

/**
 * Walk the subtree once and assign the component name, file stem, and class
 * names that both the JSX and the stylesheet will reference. Doing this in a
 * single pass is what guarantees the two files cannot disagree.
 */
function buildPair(
  node: SceneNode,
  doc: SceneDocument,
  opts?: CssModulesExportOptions,
): EmittedPair {
  const fileStem = toFileStem(opts?.fileStem ?? opts?.componentName ?? node.name);
  const componentName = toComponentName(opts?.componentName ?? node.name);
  const rules = collectCssRules(node, { doc, opts, used: new Set<string>() });
  return { rules, componentName, fileStem };
}

/**
 * JSX element tree for one CSS Modules rule, recursing through the class
 * names the stylesheet actually emitted.
 */
function renderElement(rule: Rule, byName: Map<string, Rule>, depth: number): string {
  const pad = '  '.repeat(depth);
  const classNameAttr = `className={${styleKeyAccess('styles', rule.className)}}`;

  if (rule.node.kind === 'text') {
    // JSX expression container with a JSON string literal: handles `&`, `<`,
    // `{`, quotes, backticks, and newlines with exactly one encoding pass.
    return `${pad}<span ${classNameAttr}>{${JSON.stringify(rule.node.text)}}</span>`;
  }

  const children = rule.children
    .map((name) => byName.get(name))
    .filter((child): child is Rule => child !== undefined);

  if (children.length === 0) return `${pad}<div ${classNameAttr} />`;
  const inner = children.map((child) => renderElement(child, byName, depth + 1)).join('\n');
  return `${pad}<div ${classNameAttr}>\n${inner}\n${pad}</div>`;
}

function moduleCss(rules: Rules): string {
  return `${rules
    .map(
      (rule) =>
        `.${rule.className} {\n${rule.declarations.map((declaration) => `  ${declaration}`).join('\n')}\n}`,
    )
    .join('\n\n')}\n`;
}

function componentTsx(pair: EmittedPair, hasRaster: boolean): string {
  const byName = new Map(pair.rules.map((rule) => [rule.className, rule]));
  const childNames = new Set(pair.rules.flatMap((rule) => rule.children));
  const roots = pair.rules.filter((rule) => !childNames.has(rule.className));

  const body = roots.map((rule) => renderElement(rule, byName, 2)).join('\n');
  const rasterComment = hasRaster
    ? [
        '// NOTE: one or more nodes are pre-rasterized image surfaces. Edit the artwork',
        '// in Varve and regenerate rather than hand-editing those regions as elements.',
      ]
    : [];

  return [
    `import styles from './${pair.fileStem}.module.css';`,
    '',
    ...rasterComment,
    `export function ${pair.componentName}() {`,
    '  return (',
    body,
    '  );',
    '}',
    '',
  ].join('\n');
}

function diagnosticsFor(
  node: SceneNode,
  doc: SceneDocument,
  opts?: CssModulesExportOptions,
): BundleDiagnostic[] {
  const diagnostics: BundleDiagnostic[] = [];
  const seen = new Set<string>();

  const visit = (current: SceneNode): void => {
    if (seen.has(current.id)) return;
    seen.add(current.id);
    for (const gap of cssTargetGaps(current, doc)) {
      diagnostics.push({
        severity: gap.severity,
        message: gap.fallback ? `${gap.feature} — ${gap.fallback}` : gap.feature,
        nodeId: gap.nodeId,
        nodeName: gap.nodeName,
        feature: gap.feature,
      });
    }
    if (current.kind === 'shape') {
      const src = current.fills?.find((f) => f.type === 'image' && f.image?.src)?.image?.src;
      const reason = src ? unstableImageSourceReason(src) : null;
      if (
        reason &&
        !diagnostics.some((d) => d.nodeId === current.id && d.feature === 'unportable image source')
      ) {
        diagnostics.push({
          severity: 'error',
          message: reason,
          nodeId: current.id,
          nodeName: current.name,
          feature: 'unportable image source',
        });
      }
    }
    if (current.kind === 'frame' || current.kind === 'group') {
      for (const childId of current.children) {
        const child = doc.nodes[childId];
        if (child) visit(child);
      }
    }
  };

  visit(node);

  if (opts?.rasterAssets && Object.keys(opts.rasterAssets).some((nodeId) => seen.has(nodeId))) {
    diagnostics.push({
      severity: 'info',
      message:
        'Pre-rasterized surfaces were embedded for effects with no CSS equivalent; those regions are not editable as elements in the generated component.',
    });
  }
  return diagnostics;
}

/**
 * Export the selected subtree as a two-file React + CSS Modules component.
 *
 * The `.tsx` is marked as the entry point so consumers and downloaders know
 * what to open first; the stylesheet shares its file stem, which is what the
 * generated import expects.
 */
export function exportNodeToCssModulesBundle(
  node: SceneNode,
  doc: SceneDocument,
  opts?: CssModulesExportOptions,
): GeneratedBundle {
  const pair = buildPair(node, doc, opts);
  const directory = opts?.directory ?? '';
  const prefix = directory.length > 0 ? `${directory.replace(/\/+$/, '')}/` : '';
  const hasRaster = pair.rules.some((rule) => Boolean(opts?.rasterAssets?.[rule.node.id]));

  const cssFile: GeneratedFile = {
    path: `${prefix}${pair.fileStem}.module.css`,
    language: 'css',
    mimeType: mimeTypeForLanguage('css'),
    contents: moduleCss(pair.rules),
  };
  const tsxFile: GeneratedFile = {
    path: `${prefix}${pair.fileStem}.tsx`,
    language: 'tsx',
    mimeType: mimeTypeForLanguage('tsx'),
    contents: componentTsx(pair, hasRaster),
    entry: true,
  };

  return {
    target: 'react-cssmodules',
    deliverable: 'component',
    files: [tsxFile, cssFile],
    dependencies: { react: '>=18' },
    setup: [
      `Copy ${tsxFile.path} and ${cssFile.path} into your project, keeping both files together.`,
      `Render <${pair.componentName} /> — it takes no props.`,
      'Requires a bundler with CSS Modules support (Vite, Next.js, or webpack with css-loader).',
    ],
    diagnostics: diagnosticsFor(node, doc, opts),
  };
}

/**
 * Convenience adapter over `exportNodeToCssModulesBundle` for callers that
 * want the two strings (copy, diff, preview) rather than a file list.
 */
export function exportNodeToCssModules(
  node: SceneNode,
  doc: SceneDocument,
  opts?: CssModulesExportOptions,
): { jsx: string; css: string } {
  const bundle = exportNodeToCssModulesBundle(node, doc, opts);
  return {
    jsx: bundle.files.find((file) => file.language === 'tsx')!.contents,
    css: bundle.files.find((file) => file.language === 'css')!.contents,
  };
}

/**
 * CSS Modules has the same representational limits as plain CSS.
 * Delegates to `cssTargetGaps` and adds a note about the module scope.
 */
export function cssModulesTargetGaps(node: SceneNode, doc: SceneDocument): TargetGap[] {
  return cssTargetGaps(node, doc);
}
