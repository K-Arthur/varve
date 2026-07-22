import type { Document, NodeId } from '@strata/scene';
import { renameNode } from '@strata/scene';

export interface BatchRenameOptions {
  find: string;
  replace: string;
  useRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface BatchRenamePreview {
  nodeId: string;
  originalName: string;
  newName: string;
  changed: boolean;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPattern(find: string, options: BatchRenameOptions): RegExp | null {
  let pattern = options.useRegex ? find : escapeRegex(find);
  if (options.wholeWord) {
    pattern = '\\b' + pattern + '\\b';
  }
  const flags = options.caseSensitive ? 'g' : 'gi';
  try {
    const re = new RegExp(pattern, flags);
    return re;
  } catch {
    return null;
  }
}

function hasCatastrophicBacktracking(pattern: string): boolean {
  const dangerousPatterns = [
    /\(\S*\+\)\s*\+/,
    /\(\S*\*\)\s*[+*]/,
    /\([^)]*\*\)\s*[+*]/,
    /\(\S*\?\)\s*[+*]/,
    /\(\S*\+\)\s*\*/,
    /(\+|\*)\s*\{/,
    /\+\s*\+\s*/,
    /\*\s*\+\s*/,
    /\*\s*\*\s*/,
    /\+\s*\*\s*/,
    /\{\d+,\}\s*\+/,
    /\[\s*\]\s*\+/,
  ];
  return dangerousPatterns.some((dangerous) => dangerous.test(pattern));
}

export function validateRegex(pattern: string): string | null {
  if (!pattern) {
    return 'Pattern is empty';
  }
  try {
    new RegExp(pattern);
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid regular expression';
  }
  if (hasCatastrophicBacktracking(pattern)) {
    return 'Pattern may cause catastrophic backtracking (nested quantifiers)';
  }
  return null;
}

export function computeBatchRenamePreview(
  nodeNames: Array<{ nodeId: string; name: string }>,
  options: BatchRenameOptions,
): BatchRenamePreview[] {
  if (!options.find) {
    return nodeNames
      .map(({ nodeId, name }) => ({
        nodeId,
        originalName: name,
        newName: name,
        changed: false,
      }))
      .sort((a, b) => a.originalName.localeCompare(b.originalName));
  }

  const re = buildPattern(options.find, options);
  if (!re) {
    return nodeNames
      .map(({ nodeId, name }) => ({
        nodeId,
        originalName: name,
        newName: name,
        changed: false,
      }))
      .sort((a, b) => a.originalName.localeCompare(b.originalName));
  }

  const previews: BatchRenamePreview[] = [];
  for (const { nodeId, name } of nodeNames) {
    const effectiveName = name.replace(re, options.replace);
    const changed = effectiveName !== name;
    previews.push({
      nodeId,
      originalName: name,
      newName: effectiveName,
      changed,
    });
  }

  return previews.sort((a, b) => {
    if (a.changed !== b.changed) return a.changed ? -1 : 1;
    return a.originalName.localeCompare(b.originalName);
  });
}

export function applyBatchRename(
  doc: Document,
  nodeIds: NodeId[],
  options: BatchRenameOptions,
): Document {
  if (!options.find) return doc;

  const re = buildPattern(options.find, options);
  if (!re) return doc;

  let result = doc;
  for (const id of nodeIds) {
    const node = result.nodes[id];
    if (!node) continue;
    const newName = node.name.replace(re, options.replace);
    if (newName !== node.name) {
      result = renameNode(result, id, newName);
    }
  }
  return result;
}
