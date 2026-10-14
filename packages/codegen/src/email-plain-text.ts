import type { EmailDocumentIr, EmailIrNode, EmailIrTextRun } from './email-ir-types';

export function emitEmailPlainText(ir: EmailDocumentIr): string {
  if (ir.settings.plainTextOverride !== undefined) return ir.settings.plainTextOverride;
  const lines: string[] = [];
  if (ir.settings.preheader) lines.push(ir.settings.preheader, '');
  for (const node of ir.nodes) appendNode(lines, node, 0);
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

function appendNode(lines: string[], node: EmailIrNode, depth: number): void {
  if (node.hideOnMobile && node.hideOnDesktop) return;
  const indent = '  '.repeat(depth);
  if (node.kind === 'heading') {
    const value = textFromNode(node);
    if (value) lines.push(`${indent}${value}`, '');
  } else if (node.kind === 'image') {
    const alt = node.image?.decorative ? '' : node.image?.alt || node.alt || node.name;
    if (alt) lines.push(`${indent}[Image: ${alt}]`);
    if (node.image?.link) lines.push(`${indent}${node.image.link.url}`);
  } else if (node.kind === 'button') {
    const value = buttonLabel(node);
    if (value) lines.push(`${indent}${value}`);
    const link = node.link ?? firstDescendantLink(node);
    if (link) lines.push(`${indent}${link.url}`, '');
    return;
  } else if (node.kind === 'divider') {
    lines.push(`${indent}--------------------`);
  } else if (node.kind !== 'custom-html' && node.kind !== 'spacer') {
    const value = textFromNode(node);
    if (value) lines.push(`${indent}${value}`, '');
  }
  for (const child of node.children)
    appendNode(lines, child, depth + (node.kind === 'section' ? 0 : 1));
}

function buttonLabel(node: EmailIrNode): string {
  if (node.content?.text) return node.content.text;
  const labels: string[] = [];
  const visit = (child: EmailIrNode): void => {
    if (child.content?.text) labels.push(child.content.text);
    else for (const nested of child.children) visit(nested);
  };
  for (const child of node.children) visit(child);
  return labels.join(' ').trim();
}

function firstDescendantLink(node: EmailIrNode): EmailIrNode['link'] {
  for (const child of node.children) {
    if (child.link) return child.link;
    const nested = firstDescendantLink(child);
    if (nested) return nested;
  }
  return undefined;
}

function textFromNode(node: EmailIrNode, includeNodeLink = true): string {
  if (!node.content) return '';
  const text = node.content.runs?.length
    ? node.content.runs.map(textFromRun).join('')
    : (node.content.text ?? '');
  return includeNodeLink && node.link ? `${text} (${node.link.url})` : text;
}

function textFromRun(run: EmailIrTextRun): string {
  return run.link ? `${run.text} (${run.link.url})` : run.text;
}
