/**
 * Canonical document codec for import/export and persistence boundaries.
 *
 * All external document bytes should pass through this module before they enter
 * editor state. The codec migrates, normalizes broken references, and returns
 * structured warnings so callers can report compatibility issues honestly.
 *
 * Research basis: local-first design tools need one migration/validation path
 * across disk, recovery, clipboard, and foreign-format imports; this avoids the
 * drift seen when each surface parses raw JSON independently.
 */

import type { Document } from './document';
import { isContainer } from './document';
import type { NodeId, SceneNode } from './types';
import {
  CURRENT_DOCUMENT_VERSION,
  migrateDocumentDetailed,
  serializeDocument as serializeVersionedDocument,
} from './version';

export interface DocumentCodecWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  path?: string;
}

export type DocumentDecodeResult =
  | { ok: true; document: Document; warnings: DocumentCodecWarning[] }
  | { ok: false; warnings: DocumentCodecWarning[]; error: string };

export interface DocumentNormalizeResult {
  document: Document;
  warnings: DocumentCodecWarning[];
}

export interface DocumentClosure {
  nodeIds: Set<NodeId>;
  nodes: Record<NodeId, SceneNode>;
}

function warning(
  code: string,
  message: string,
  severity: DocumentCodecWarning['severity'] = 'warning',
  path?: string,
): DocumentCodecWarning {
  return path ? { code, message, severity, path } : { code, message, severity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateShape(raw: Record<string, unknown>): string | null {
  if (typeof raw.id !== 'string') return 'Document id must be a string';
  if (typeof raw.name !== 'string') return 'Document name must be a string';
  if (!Array.isArray(raw.rootChildren)) return 'Document rootChildren must be an array';
  if (!isRecord(raw.nodes)) return 'Document nodes must be an object';
  if (!isRecord(raw.components)) return 'Document components must be an object';
  if (typeof raw.nextId !== 'number') return 'Document nextId must be a number';
  return null;
}

function maxNumericNodeId(nodes: Record<NodeId, SceneNode>): number {
  let max = 0;
  for (const id of Object.keys(nodes)) {
    const match = /^n(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

function normalizeDocument(doc: Document): DocumentNormalizeResult {
  const warnings: DocumentCodecWarning[] = [];
  const nodes: Record<NodeId, SceneNode> = {};

  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!node || node.id !== id) {
      warnings.push(
        warning('document.node-id-normalized', `Node ${id} had a mismatched id`, 'warning', id),
      );
    }

    if (isContainer(node)) {
      const children: NodeId[] = [];
      for (const childId of node.children) {
        if (doc.nodes[childId]) {
          children.push(childId);
        } else {
          warnings.push(
            warning(
              'document.orphan-child',
              `Container ${id} referenced missing child ${childId}`,
              'warning',
              `${id}.children`,
            ),
          );
        }
      }
      nodes[id] = { ...node, id, children } as SceneNode;
    } else {
      nodes[id] = { ...node, id } as SceneNode;
    }
  }

  const rootChildren: NodeId[] = [];
  for (const rootId of doc.rootChildren) {
    if (nodes[rootId]) {
      rootChildren.push(rootId);
    } else {
      warnings.push(
        warning('document.orphan-root', `Root referenced missing node ${rootId}`, 'warning'),
      );
    }
  }

  const minNextId = maxNumericNodeId(nodes) + 1;
  const nextId = Math.max(doc.nextId, minNextId, 1);

  return {
    document: {
      ...doc,
      formatVersion: CURRENT_DOCUMENT_VERSION,
      rootChildren,
      nodes,
      nextId,
      components: doc.components ?? {},
    },
    warnings,
  };
}

function collectNodeClosure(doc: Document, rootIds: NodeId[]): DocumentClosure {
  const nodeIds = new Set<NodeId>();
  const nodes: Record<NodeId, SceneNode> = {};

  function visit(id: NodeId): void {
    if (nodeIds.has(id)) return;
    const node = doc.nodes[id];
    if (!node) return;
    nodeIds.add(id);
    nodes[id] = node;
    if (isContainer(node)) {
      for (const childId of node.children) visit(childId);
    }
  }

  for (const id of rootIds) visit(id);
  return { nodeIds, nodes };
}

export const DocumentCodec = {
  decode(json: string): DocumentDecodeResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid JSON',
        warnings: [warning('document.invalid-json', 'Document JSON could not be parsed', 'error')],
      };
    }

    const migration = migrateDocumentDetailed(parsed);
    if (!migration) {
      return {
        ok: false,
        error: 'Document payload was not an object',
        warnings: [
          warning('document.invalid-shape', 'Document payload was not an object', 'error'),
        ],
      };
    }

    const shapeError = validateShape(migration.document);
    if (shapeError) {
      return {
        ok: false,
        error: shapeError,
        warnings: [warning('document.invalid-shape', shapeError, 'error')],
      };
    }

    const normalized = normalizeDocument(migration.document as unknown as Document);
    const warnings = [...normalized.warnings];
    if (migration.migrated) {
      warnings.unshift(
        warning(
          'document.migrated',
          `Document migrated from ${migration.fromVersion} to ${migration.toVersion}`,
          'info',
        ),
      );
    }
    warnings.unshift(
      ...migration.warnings.map((message) =>
        warning('document.forward-compatibility', message, 'warning'),
      ),
    );

    return { ok: true, document: normalized.document, warnings };
  },

  encode(doc: Document): string {
    return serializeVersionedDocument(normalizeDocument(doc).document);
  },

  normalize: normalizeDocument,
  collectNodeClosure,
};
