/**
 * Simple force-directed layout for auto-arrange.
 * Uses spring-electrical model (Fruchterman-Reingold simplified).
 * Bounded iterations with deterministic grid fallback.
 */

export interface ForceLayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface ForceLayoutOptions {
  width: number;
  height: number;
  /** Target ideal edge length for spring force */
  idealLength: number;
  /** Repulsion strength multiplier */
  repulsion: number;
  /** Attraction strength multiplier */
  attraction: number;
  /** Max iterations (bounded for performance) */
  maxIterations: number;
  /** Convergence threshold: stop when max displacement < this */
  convergenceThreshold: number;
}

export interface ForceLayoutResult {
  id: string;
  x: number;
  y: number;
}

const DEFAULT_OPTIONS: ForceLayoutOptions = {
  width: 400,
  height: 400,
  idealLength: 100,
  repulsion: 100,
  attraction: 0.01,
  maxIterations: 100,
  convergenceThreshold: 1,
};

/**
 * Compute force-directed layout.
 * Falls back to grid layout when nodes don't have edges (no connections).
 */
export function computeForceLayout(
  nodes: ForceLayoutNode[],
  edges: Array<{ source: string; target: string }>,
  options?: Partial<ForceLayoutOptions>,
): ForceLayoutResult[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (nodes.length === 0) return [];

  // No edges — fall back to grid layout
  if (edges.length === 0) {
    return computeGridFallback(nodes, opts.width, opts.height);
  }

  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();

  // Initialise random positions
  for (const node of nodes) {
    positions.set(node.id, {
      x: Math.random() * opts.width * 0.8 + opts.width * 0.1,
      y: Math.random() * opts.height * 0.8 + opts.height * 0.1,
      vx: 0,
      vy: 0,
    });
  }

  const temperature = opts.width * 0.1;
  const epsilon = 0.01;

  for (let iter = 0; iter < opts.maxIterations; iter++) {
    const cooling = temperature * (1 - iter / opts.maxIterations);
    let maxDisplacement = 0;

    // Compute forces
    const forces = new Map<string, { fx: number; fy: number }>();
    for (const node of nodes) {
      forces.set(node.id, { fx: 0, fy: 0 });
    }

    // Repulsion: all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const ni = nodes[i]!;
        const nj = nodes[j]!;
        const pi = positions.get(ni.id)!;
        const pj = positions.get(nj.id)!;

        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), epsilon);

        dx /= dist;
        dy /= dist;

        const repForce = (opts.repulsion * opts.idealLength) / (dist * dist);
        const fi = forces.get(ni.id)!;
        const fj = forces.get(nj.id)!;
        fi.fx += dx * repForce;
        fi.fy += dy * repForce;
        fj.fx -= dx * repForce;
        fj.fy -= dy * repForce;
      }
    }

    // Attraction: along edges
    for (const edge of edges) {
      const pi = positions.get(edge.source);
      const pj = positions.get(edge.target);
      if (!pi || !pj) continue;

      let dx = pj.x - pi.x;
      let dy = pj.y - pi.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), epsilon);

      dx /= dist;
      dy /= dist;

      const attrForce = (dist - opts.idealLength) * opts.attraction;
      const fi = forces.get(edge.source);
      const fj = forces.get(edge.target);
      if (fi && fj) {
        fi.fx += dx * attrForce;
        fi.fy += dy * attrForce;
        fj.fx -= dx * attrForce;
        fj.fy -= dy * attrForce;
      }
    }

    // Apply forces with cooling
    for (const node of nodes) {
      const pos = positions.get(node.id)!;
      const force = forces.get(node.id)!;
      const fLen = Math.max(Math.sqrt(force.fx * force.fx + force.fy * force.fy), epsilon);

      const displacement = Math.min(cooling, fLen);
      pos.x += (force.fx / fLen) * displacement;
      pos.y += (force.fy / fLen) * displacement;

      // Clamp to bounds
      pos.x = Math.max(node.width / 2, Math.min(opts.width - node.width / 2, pos.x));
      pos.y = Math.max(node.height / 2, Math.min(opts.height - node.height / 2, pos.y));

      maxDisplacement = Math.max(maxDisplacement, displacement);
    }

    if (maxDisplacement < opts.convergenceThreshold) break;
  }

  return nodes.map((node) => {
    const pos = positions.get(node.id)!;
    return {
      id: node.id,
      x: pos.x - node.width / 2,
      y: pos.y - node.height / 2,
    };
  });
}

/**
 * Fallback: arrange nodes in a grid layout when no edges exist.
 */
function computeGridFallback(
  nodes: ForceLayoutNode[],
  width: number,
  height: number,
): ForceLayoutResult[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rows = Math.ceil(nodes.length / cols);

  const cellW = width / cols;
  const cellH = height / rows;
  const gap = 16;

  return nodes.map((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      id: node.id,
      x: col * cellW + gap / 2,
      y: row * cellH + gap / 2,
    };
  });
}
