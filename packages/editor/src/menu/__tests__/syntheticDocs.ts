import { createDocument, type Document, makeShapeNode } from '@strata/scene';

export interface SyntheticDocOptions {
  nodeCount: number;
  selectionSize?: number;
  findingCount?: number;
  pageCount?: number;
  masterCount?: number;
}

export function buildSyntheticDoc(opts: SyntheticDocOptions): {
  doc: Document;
  selection: string[];
} {
  let doc = createDocument('perf-bench', true);

  const nodes = { ...doc.nodes };
  const rootChildren: string[] = [...doc.rootChildren];
  const ids: string[] = [];

  for (let i = 0; i < opts.nodeCount; i++) {
    const id = `perf-node-${i}`;
    const col = i % 200;
    const row = Math.floor(i / 200);
    const node = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
      {
        name: `Node ${i}`,
        transform: [1, 0, 0, 1, col * 100, row * 100],
      },
    );
    nodes[id] = node;
    rootChildren.push(id);
    ids.push(id);
  }

  doc = { ...doc, nodes, rootChildren } as Document;

  let selection: string[] = [];
  if (opts.selectionSize && opts.selectionSize > 0) {
    selection = ids.slice(0, Math.min(opts.selectionSize, ids.length));
  } else if (opts.nodeCount > 0) {
    selection = [ids[0]!];
  }

  if (opts.pageCount && opts.pageCount > 1) {
    const pages = [];
    for (let i = 0; i < opts.pageCount; i++) {
      pages.push({ id: `page-${i}`, name: `Page ${i + 1}` });
    }
    doc = { ...doc, pages };
  }

  if (opts.masterCount && opts.masterCount > 0) {
    const masters: Record<string, { name: string }> = {};
    for (let i = 0; i < opts.masterCount; i++) {
      masters[`master-${i}`] = { name: `Master ${i + 1}` };
    }
    doc = { ...doc, masters };
  }

  return { doc, selection };
}

export function buildSelectionDoc(
  nodeCount: number,
  selectionSize: number,
): {
  doc: Document;
  selection: string[];
} {
  return buildSyntheticDoc({ nodeCount, selectionSize });
}

export function buildAuditDoc(findingCount: number): {
  doc: Document;
  selection: string[];
  findings: Array<{ severity?: string }>;
} {
  const { doc, selection } = buildSyntheticDoc({ nodeCount: 1000 });
  const severities: string[] = ['critical', 'warning', 'info', 'style'];
  const findings: Array<{ severity?: string }> = [];
  for (let i = 0; i < findingCount; i++) {
    findings.push({ severity: severities[i % severities.length] });
  }
  return { doc, selection, findings };
}

export function buildPageDoc(
  pageCount: number,
  masterCount: number,
): {
  doc: Document;
  selection: string[];
} {
  return buildSyntheticDoc({
    nodeCount: 100,
    pageCount,
    masterCount,
  });
}
