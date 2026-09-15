import { exportDocumentToSvgAdvanced, exportNodeToSvg } from '@varve/codegen';
import {
  addNode,
  applyShapeBuilderAction,
  buildShapeBuilderModel,
  createDocument,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';

const identity = [1, 0, 0, 1, 0, 0] as const;

describe('Shape Builder export', () => {
  it('serializes a created compound result with its hole and authored fill rule', () => {
    const point = (x: number, y: number) => ({ x, y, handleIn: null, handleOut: null });
    const outer = [point(0, 0), point(100, 0), point(100, 100), point(0, 100)];
    const hole = [point(25, 25), point(25, 75), point(75, 75), point(75, 25)];
    let doc = createDocument('shape-builder-export', true);
    doc = addNode(
      doc,
      makeShapeNode(
        'donut',
        {
          kind: 'path',
          points: outer,
          contours: [outer, hole],
          holes: [hole],
          closed: true,
          tolerance: 3,
          fillRule: 'evenodd',
        },
        { transform: identity },
      ),
    );

    const model = buildShapeBuilderModel(doc, ['donut']);
    const applied = applyShapeBuilderAction(
      doc,
      ['donut'],
      model.faces.filter((face) => face.selectable).map((face) => face.id),
      'create',
      { expectedRevision: model.revision },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const result = applied.doc.nodes[applied.createdNodeIds[0]!];
    expect(result?.kind).toBe('shape');
    if (result?.kind !== 'shape') return;

    const resultSvg = exportNodeToSvg(result, applied.doc);
    expect(resultSvg).toContain('fill-rule="evenodd"');
    const pathData = /d="([^"]+)"/.exec(resultSvg)?.[1] ?? '';
    // The compound result keeps its outer ring and hole as separate subpaths
    // in one path element; no connector segment is fabricated between them.
    expect((pathData.match(/M/g) ?? []).length).toBeGreaterThanOrEqual(2);

    const documentSvg = exportDocumentToSvgAdvanced(applied.doc, {});
    expect(documentSvg).toContain('fill-rule="evenodd"');
    expect((documentSvg.match(/<path\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
