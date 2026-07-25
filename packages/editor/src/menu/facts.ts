import type { Document, SceneNode } from '@strata/scene';
import { isContainer } from '@strata/scene';
import type { WorkspaceMode } from '../workspace/workspaceTypes';
import { computeCapabilities } from './capabilities';
import type { DocumentFacts, IntelFacts, PlatformFacts, SelectionFacts } from './types';

let _lastSelectionKey = '';
let _lastSelectionFacts: SelectionFacts | null = null;

export function computeSelectionFacts(
  selection: string[],
  nodes: Record<string, SceneNode>,
): SelectionFacts {
  const key = selection.join(',');
  if (key === _lastSelectionKey && _lastSelectionFacts) {
    return _lastSelectionFacts;
  }
  _lastSelectionKey = key;

  const selected: SceneNode[] = [];
  for (const id of selection) {
    const n = nodes[id];
    if (n) selected.push(n);
  }
  const count = selected.length;
  const kinds = new Set(selected.map((n) => n.kind));
  const hasComponentInstance = selected.some((n) => 'componentId' in n && n.componentId != null);
  const isLocked = selected.some((n) => n.locked === true);
  const hasMask = selected.some((n) => {
    const s = n as SceneNode & { mask?: unknown };
    return s.mask != null;
  });
  const hasAdjustment = selected.some((n) => n.kind === 'adjustment');

  const fact: SelectionFacts = {
    count,
    isEmpty: count === 0,
    isSingle: count === 1,
    isMultiple: count >= 2,
    kinds,
    hasText: selected.some((n) => n.kind === 'text'),
    hasVector: selected.some((n) => n.kind === 'shape' || n.kind === 'path'),
    hasImage: selected.some((n) => {
      const s = n as SceneNode & { shape?: { type?: string } };
      return s.shape?.type === 'image' || n.kind === 'rasterLayer';
    }),
    hasFrame: selected.some((n) => n.kind === 'frame'),
    hasGroup: selected.some((n) => n.kind === 'group'),
    allSameType: count > 0 && selected.every((n) => n.kind === selected[0]!.kind),
    hasComponentInstance,
    isLocked,
    boundsCount: count,
    canGroup: count >= 2,
    canUngroup: count === 1 && selected.some((n) => isContainer(n) && n.children.length > 0),
    hasMask,
    hasAdjustment,
  };

  _lastSelectionFacts = fact;
  return fact;
}

let _lastDocKey = '';
let _lastDocFacts: DocumentFacts | null = null;

export function computeDocumentFacts(doc: Document, activePageId: string | null): DocumentFacts {
  const masterIds = doc.masters ? Object.keys(doc.masters) : [];
  const activePage = activePageId ? doc.pages?.find((p) => p.id === activePageId) : null;
  const currentPageMasterId = activePage?.masterPageId ?? null;
  const currentPageMaster =
    currentPageMasterId && doc.masters?.[currentPageMasterId]
      ? {
          id: currentPageMasterId,
          name: (doc.masters[currentPageMasterId] as { name: string }).name,
        }
      : null;
  const currentPageIsMaster = activePageId != null && masterIds.includes(activePageId);

  const key = `${Object.keys(doc.nodes).length}:${doc.pages?.length ?? 0}:${activePageId ?? ''}:${currentPageMasterId ?? ''}:${currentPageIsMaster}:${masterIds.length}`;
  if (key === _lastDocKey && _lastDocFacts) {
    return _lastDocFacts;
  }
  _lastDocKey = key;

  const fact: DocumentFacts = {
    nodeCount: Object.keys(doc.nodes).length,
    pageCount: doc.pages?.length ?? 1,
    hasMasterPages: masterIds.length > 0,
    currentPageHasMaster: currentPageMaster != null,
    currentPageMaster,
    currentPageIsMaster,
    masterPages: doc.masters
      ? Object.entries(doc.masters).map(([id, m]) => ({
          id,
          name: (m as { name: string }).name,
        }))
      : [],
    activePageId,
    hasSelection: false,
    hasMultipleSelection: false,
  };

  _lastDocFacts = fact;
  return fact;
}

export function buildMenuContext(
  selection: string[],
  doc: Document,
  workspace: WorkspaceMode,
  platform: PlatformFacts,
  intel: IntelFacts,
) {
  const selectionFacts = computeSelectionFacts(selection, doc.nodes);
  const documentFacts = computeDocumentFacts(doc, selection[0] ?? null);
  documentFacts.hasSelection = selectionFacts.count > 0;
  documentFacts.hasMultipleSelection = selectionFacts.count >= 2;

  return {
    selection: selectionFacts,
    document: documentFacts,
    workspace,
    platform,
    intelligence: intel,
  };
}

export function detectPlatformFacts(kind?: string, os_?: string): PlatformFacts {
  const capabilities = computeCapabilities(kind);

  let os: PlatformFacts['os'] = 'unknown';
  if (typeof navigator !== 'undefined') {
    const p = navigator.platform?.toLowerCase() ?? '';
    if (p.includes('mac')) os = 'mac';
    else if (p.includes('win')) os = 'windows';
    else if (p.includes('linux')) os = 'linux';
  }
  if (os_) {
    if (os_.includes('mac')) os = 'mac';
    else if (os_.includes('win')) os = 'windows';
    else if (os_.includes('linux')) os = 'linux';
  }

  return { os, capabilities };
}

export function buildIntelFacts(
  findings: Array<{ severity?: string }> | undefined,
  lastScanAt: number | null,
  scanInProgress: boolean,
): IntelFacts {
  const bySeverity: Record<string, number> = {};
  let total = 0;
  if (findings) {
    for (const f of findings) {
      const s = f.severity ?? 'unknown';
      bySeverity[s] = (bySeverity[s] ?? 0) + 1;
      total++;
    }
  }
  return {
    findingCount: total,
    findingCountBySeverity: bySeverity,
    lastScanAt,
    scanInProgress,
  };
}
