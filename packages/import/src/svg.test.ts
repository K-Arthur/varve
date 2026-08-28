import { describe, expect, it } from 'vitest';
import { parseSvg } from './svg';

describe('parseSvg', () => {
  it('parses a rect element', () => {
    const result = parseSvg('<svg><rect x="10" y="20" width="100" height="50" fill="red" /></svg>');
    expect(result.nodeIds.length).toBe(1);
    expect(result.warnings).toHaveLength(0);
    const node = result.document.nodes[result.nodeIds[0]!];
    expect(node?.kind).toBe('shape');
    if (node?.kind === 'shape') {
      expect(node.shape.kind).toBe('rect');
      if (node.shape.kind === 'rect') {
        expect(node.shape.w).toBe(100);
        expect(node.shape.h).toBe(50);
      }
    }
  });

  it('parses a circle element', () => {
    const result = parseSvg('<svg><circle cx="50" cy="50" r="40" fill="blue" /></svg>');
    expect(result.nodeIds.length).toBe(1);
    const node = result.document.nodes[result.nodeIds[0]!];
    expect(node?.kind).toBe('shape');
    if (node?.kind === 'shape') {
      expect(node.shape.kind).toBe('circle');
    }
  });

  it('parses an ellipse element', () => {
    const result = parseSvg('<svg><ellipse cx="100" cy="80" rx="60" ry="40" fill="green" /></svg>');
    expect(result.nodeIds.length).toBe(1);
    const node = result.document.nodes[result.nodeIds[0]!];
    expect(node?.kind).toBe('shape');
    if (node?.kind === 'shape') {
      expect(node.shape.kind).toBe('ellipse');
    }
  });

  it('parses a line element', () => {
    const result = parseSvg('<svg><line x1="0" y1="0" x2="100" y2="100" stroke="black" /></svg>');
    expect(result.nodeIds.length).toBe(1);
    const node = result.document.nodes[result.nodeIds[0]!];
    expect(node?.kind).toBe('shape');
    if (node?.kind === 'shape') {
      expect(node.shape.kind).toBe('line');
      if (node.shape.kind === 'line') {
        expect(node.shape.to[0]).toBe(100);
        expect(node.shape.to[1]).toBe(100);
      }
    }
  });

  it('parses a polygon element', () => {
    const result = parseSvg('<svg><polygon points="10,10 20,40 40,20" fill="yellow" /></svg>');
    expect(result.nodeIds.length).toBe(1);
    const node = result.document.nodes[result.nodeIds[0]!];
    expect(node?.kind).toBe('shape');
    if (node?.kind === 'shape') {
      expect(node.shape.kind).toBe('polygon');
    }
  });

  it('parses a path element with M/L/C commands', () => {
    const result = parseSvg('<svg><path d="M10 10 L50 10 L50 50 Z" fill="purple" /></svg>');
    expect(result.nodeIds.length).toBe(1);
    const node = result.document.nodes[result.nodeIds[0]!];
    expect(node?.kind).toBe('shape');
    if (node?.kind === 'shape') {
      expect(node.shape.kind).toBe('path');
      if (node.shape.kind === 'path') {
        expect(node.shape.points.length).toBeGreaterThanOrEqual(3);
        expect(node.shape.closed).toBe(true);
      }
    }
  });

  it('preserves multiple SVG subpaths and their fill rule as a compound path', () => {
    const result = parseSvg(
      '<svg><path fill-rule="evenodd" d="M0 0H100V100H0ZM25 25H75V75H25Z" /></svg>',
    );
    const node = result.document.nodes[result.nodeIds[0]!];
    expect(node?.kind).toBe('shape');
    if (node?.kind === 'shape' && node.shape.kind === 'path') {
      expect(node.shape.closed).toBe(true);
      expect(node.shape.points).toHaveLength(4);
      expect(node.shape.holes).toHaveLength(1);
      expect(node.shape.holes?.[0]).toHaveLength(4);
      expect(node.shape.fillRule).toBe('evenodd');
    }
  });

  it('parses a group (g) element with children', () => {
    const result = parseSvg(
      '<svg><g transform="translate(10,20)"><rect x="0" y="0" width="50" height="30" fill="red" /><circle cx="25" cy="15" r="10" fill="blue" /></g></svg>',
    );
    // Group collapses into a FrameNode with 2 children
    expect(result.nodeIds.length).toBe(1);
    const node = result.document.nodes[result.nodeIds[0]!];
    expect(node?.kind).toBe('frame');
    if (node?.kind === 'frame') {
      expect(node.children.length).toBe(2);
    }
  });

  it('parses a text element', () => {
    const result = parseSvg(
      '<svg><text x="10" y="20" font-size="16" font-family="Arial">Hello World</text></svg>',
    );
    expect(result.nodeIds.length).toBe(1);
    const node = result.document.nodes[result.nodeIds[0]!];
    expect(node?.kind).toBe('text');
    if (node?.kind === 'text') {
      expect(node.text).toBe('Hello World');
      expect(node.fontSize).toBe(16);
      expect(node.fontFamily).toBe('Arial');
    }
  });

  it('parses transform attribute (translate)', () => {
    const result = parseSvg(
      '<svg><rect x="0" y="0" width="100" height="50" transform="translate(30,40)" fill="red" /></svg>',
    );
    expect(result.nodeIds.length).toBe(1);
    const node = result.document.nodes[result.nodeIds[0]!];
    expect(node?.transform[4]).toBeCloseTo(30);
    expect(node?.transform[5]).toBeCloseTo(40);
  });

  it('parses fill and stroke attributes', () => {
    const result = parseSvg(
      '<svg><rect x="0" y="0" width="100" height="50" fill="#ff0000" stroke="#00ff00" stroke-width="2" /></svg>',
    );
    expect(result.nodeIds.length).toBe(1);
    const node = result.document.nodes[result.nodeIds[0]!];
    if (node?.kind === 'shape') {
      expect(node.fill).toBeDefined();
      expect(node.strokes.length).toBeGreaterThan(0);
      if (node.strokes[0]) {
        expect(node.strokes[0].color).toBeDefined();
        expect(node.strokes[0].weight).toBe(2);
      }
    }
  });

  it('imports linear SVG gradients with stop opacity and explicit interpolation', () => {
    const result = parseSvg(
      '<svg><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0" color-interpolation="linearRGB" spreadMethod="reflect"><stop offset="0%" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/></linearGradient></defs><rect width="100" height="40" fill="url(#g)"/></svg>',
    );
    const node = result.document.nodes[result.nodeIds[0]!];
    expect(result.warnings).toHaveLength(0);
    expect(node?.fills?.[0]?.type).toBe('gradient');
    const gradient = node?.fills?.[0]?.gradient;
    expect(gradient?.type).toBe('linear');
    expect(gradient?.interpolationSpace).toBe('linear-srgb');
    expect(gradient?.tilingMode).toBe('reflect');
    expect(gradient?.stops[1]?.color).toMatchObject({ space: 'rgb', a: 128 });
  });

  it('imports full user-space linear gradient geometry without collapsing it to rotation', () => {
    const result = parseSvg(
      '<svg><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1=".5" x2="1" y2=".5" gradientTransform="matrix(1.2 .3 -.4 .8 7 11)"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="100" height="40" fill="url(#g)"/></svg>',
    );
    const gradient = result.document.nodes[result.nodeIds[0]!]!.fills![0]!.gradient;

    expect(gradient?.transform).toEqual([1.2, 0.3, -0.4, 0.8, 7, 11]);
    expect(gradient?.rotation).toBeUndefined();
  });

  it('converts object-bounding-box endpoints and affine radial axes into fill matrices', () => {
    const linear = parseSvg(
      '<svg><defs><linearGradient id="g" x1="20%" y1="25%" x2="80%" y2="75%" gradientTransform="matrix(1 .2 -.1 .8 .1 .15)"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="200" height="100" fill="url(#g)"/></svg>',
    );
    const radial = parseSvg(
      '<svg><defs><radialGradient id="r" gradientUnits="userSpaceOnUse" cx=".5" cy=".5" r=".5" gradientTransform="matrix(1 .25 -.4 .75 9 11)"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient></defs><rect width="100" height="100" fill="url(#r)"/></svg>',
    );

    const linearTransform =
      linear.document.nodes[linear.nodeIds[0]!]!.fills![0]!.gradient?.transform;
    expect(linearTransform).toHaveLength(6);
    [110, 52, -112, 38, 111, 20].forEach((expected, index) => {
      expect(linearTransform?.[index]).toBeCloseTo(expected, 10);
    });
    expect(radial.document.nodes[radial.nodeIds[0]!]!.fills![0]!.gradient?.transform).toEqual([
      1, 0.25, -0.4, 0.75, 9, 11,
    ]);
  });

  it('reports SVG radial focal points that cannot be represented by an affine field', () => {
    const result = parseSvg(
      '<svg><defs><radialGradient id="r" cx="50%" cy="50%" fx="25%" fy="40%"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient></defs><rect width="100" height="80" fill="url(#r)"/></svg>',
    );
    expect(result.warnings).toContain(
      'SVG gradient #r has an off-centre focal point; the imported affine radial field uses the centre',
    );
  });

  it('reports user-space percentage gradients that need viewport context', () => {
    const result = parseSvg(
      '<svg width="200" height="100"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10%" x2="90%"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="100" height="50" fill="url(#g)"/></svg>',
    );
    expect(result.warnings).toContain(
      'SVG gradient #g uses userSpaceOnUse percentages; the imported field is normalized to the target bounds',
    );
  });

  it('imports radial SVG gradients and warns on unsupported paint references', () => {
    const radial = parseSvg(
      '<svg><defs><radialGradient id="r"><stop offset="0" stop-color="white"/><stop offset="100%" stop-color="black"/></radialGradient></defs><circle r="20" fill="url(#r)"/><rect width="10" height="10" fill="url(#missing)"/></svg>',
    );
    const radialNode = radial.document.nodes[radial.nodeIds[0]!];
    expect(radialNode?.fills?.[0]?.gradient?.type).toBe('radial');
    expect(radial.warnings).toContain('SVG fill references unsupported resource: #missing');
  });

  it('handles empty SVG', () => {
    const result = parseSvg('');
    expect(result.nodeIds).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('handles malformed SVG gracefully', () => {
    const result = parseSvg('not svg content');
    expect(result.nodeIds).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('group with path-only children gets non-zero bounds (icon import)', () => {
    // This is the exact scenario that broke icon import: an SVG with a <g>
    // wrapping only <path> elements. Before the fix, computeGroupBounds
    // returned w:0 h:0 because it lacked a 'path' case.
    const result = parseSvg(
      '<svg viewBox="0 0 24 24"><g><path d="M10 20v-6h4v6h5v-8h3L12 3L2 12h3v8z" fill="currentColor"/></g></svg>',
    );
    expect(result.nodeIds.length).toBe(1);
    const groupNode = result.document.nodes[result.nodeIds[0]!];
    expect(groupNode?.kind).toBe('frame');
    if (groupNode?.kind === 'frame') {
      // The group must have non-zero dimensions so the frame clip doesn't
      // hide its children.
      expect(groupNode.w).toBeGreaterThan(0);
      expect(groupNode.h).toBeGreaterThan(0);
      // And it should have the path child.
      expect(groupNode.children.length).toBe(1);
      const child = result.document.nodes[groupNode.children[0]!];
      expect(child?.kind).toBe('shape');
      if (child?.kind === 'shape') {
        expect(child.shape.kind).toBe('path');
      }
    }
  });

  it('multiple path children in group compute correct combined bounds', () => {
    const result = parseSvg(
      '<svg viewBox="0 0 24 24"><g>' +
        '<path d="M2 2h10v10H2z" fill="red"/>' +
        '<path d="M12 12h10v10H12z" fill="blue"/>' +
        '</g></svg>',
    );
    expect(result.nodeIds.length).toBe(1);
    const groupNode = result.document.nodes[result.nodeIds[0]!];
    if (groupNode?.kind === 'frame') {
      // Both paths contribute to the group bounds.
      expect(groupNode.w).toBeGreaterThan(0);
      expect(groupNode.h).toBeGreaterThan(0);
      expect(groupNode.children.length).toBe(2);
    }
  });
});
