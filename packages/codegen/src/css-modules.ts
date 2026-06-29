/**
 * React + CSS Modules target emitter.
 *
 * Produces a pair: JSX component with `styles.className` references and a
 * `.module.css` file.
 *
 * Research basis: CSS Modules spec (github.com/css-modules/css-modules).
 */

import type { Document as SceneDocument, SceneNode } from '@strata/scene';
import { exportNodeToCss, type CssExportOptions } from './css';
import { escapeXml } from './shared';

export interface CssModulesExportOptions extends CssExportOptions {
  /** Component name. Default: node.name or 'Component'. */
  componentName?: string;
}

export function exportNodeToCssModules(
  node: SceneNode,
  doc: SceneDocument,
  opts?: CssModulesExportOptions,
): { jsx: string; css: string } {
  const css = exportNodeToCss(node, doc, opts);
  const selector = node.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'node';
  const componentName = (opts?.componentName ?? (node.name[0]?.toUpperCase() + node.name.slice(1))) || 'Component';

  const cssWithModule = css.replace(/\.([a-z][\w-]*)/, `.${selector}`);
  const jsx = node.kind === 'text'
    ? `import styles from './${componentName}.module.css';\n\nexport function ${componentName}() {\n  return <span className={styles.${selector}}>{${JSON.stringify(escapeXml(node.text))}}</span>;\n}\n`
    : `import styles from './${componentName}.module.css';\n\nexport function ${componentName}() {\n  return <div className={styles.${selector}} />;\n}\n`;

  return { jsx, css: cssWithModule };
}
