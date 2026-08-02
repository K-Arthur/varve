import { createDocument, makeShapeNode } from './packages/scene/src/index.ts';

const doc = createDocument('bench', true);
const nodes = { ...doc.nodes };
const rootChildren = [...doc.rootChildren];
for (let i = 0; i < 2000; i++) {
  const col = i % 100;
  const row = Math.floor(i / 100);
  const id = `bench-${i}`;
  const node = makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w: 48, h: 40 },
    {
      name: `Rect ${i}`,
      transform: [1, 0, 0, 1, col * 120, row * 120],
    },
  );
  nodes[id] = node;
  rootChildren.push(id);
}
const big = { ...doc, nodes, rootChildren };
console.log('nodes:', Object.keys(big.nodes).length, 'jsonLen:', JSON.stringify(big).length);
