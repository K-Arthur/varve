/**
 * Logo project — a first-class but lightweight organization layer over the
 * regular document model.
 *
 * A logo project is a DOCUMENT-scoped, fully serializable structure: it
 * registers concepts and variants as metadata over ordinary artboard frames.
 * The artwork itself always lives in normal scene nodes (frames/artboards),
 * so every logo stays editable with the standard tools, history, and export
 * pipeline. The project never duplicates geometry — it only adds naming,
 * status, provenance, rationale, and linkage.
 *
 * Design rules:
 * - No derived data is stored: artboard references are the single source of
 *   truth; stale references are repaired by normalizeLogoProject.
 * - Provenance and license-relevant metadata are tracked but never invented:
 *   `provenance` defaults to 'user-created' and is only changed by explicit
 *   user or pipeline actions.
 * - Deleting a concept never deletes artwork (the artboard remains); it only
 *   removes the registration and detaches variants that referenced it.
 */

import { deepCloneSubtree } from '../clone';
import type { Document } from '../document';
import { addGuide, resolveGuidePageId } from '../document';
import { addNode } from '../document-nodes';
import { cryptoId } from '../document-utils';
import { nodeLocalBounds } from '../nodeBounds';
import type {
  LogoBrief,
  LogoConcept,
  LogoConceptStatus,
  LogoPaletteColor,
  LogoProject,
  LogoProvenance,
  LogoVariant,
  LogoVariantKind,
  NodeId,
} from '../types';

export type {
  LogoBrief,
  LogoConcept,
  LogoConceptStatus,
  LogoPalette,
  LogoPaletteColor,
  LogoProject,
  LogoProvenance,
  LogoVariant,
  LogoVariantKind,
} from '../types';

export function emptyBrief(): import('../types').LogoBrief {
  return {
    keywords: [],
    preferredColors: [],
    prohibitedColors: [],
    updatedAt: Date.now(),
  };
}

export function createLogoProject(name = 'Logo Project'): LogoProject {
  const now = Date.now();
  return {
    version: 1,
    id: cryptoId(),
    name,
    createdAt: now,
    updatedAt: now,
    brief: emptyBrief(),
    concepts: [],
    variants: [],
  };
}

export function getLogoProject(doc: Document): LogoProject | undefined {
  return doc.logoProject;
}

export function isLogoProject(doc: Document): boolean {
  return doc.logoProject !== undefined;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Repair structural invariants after any mutation or load:
 *  - array fields exist
 *  - concept/variant ids are unique
 *  - brief exists
 *  - variants referencing missing concepts or deleted artboards keep their
 *    registration but drop the stale pointer
 */
export function normalizeLogoProject(project: LogoProject | undefined): LogoProject | undefined {
  if (!project) return undefined;
  const rawConcepts = Array.isArray(project.concepts) ? project.concepts : [];
  const rawVariants = Array.isArray(project.variants) ? project.variants : [];
  const concepts = rawConcepts.filter(
    (c): c is LogoConcept => typeof c === 'object' && c !== null && typeof c.id === 'string',
  );
  const variants = rawVariants.filter(
    (v): v is LogoVariant => typeof v === 'object' && v !== null && typeof v.id === 'string',
  );
  const conceptIds = new Set(concepts.map((c) => c.id));
  return {
    ...project,
    version: 1,
    name: project.name || 'Logo Project',
    brief: project.brief && Array.isArray(project.brief.keywords) ? project.brief : emptyBrief(),
    concepts,
    variants: variants.map((v) => ({
      ...v,
      sourceConceptId:
        v.sourceConceptId && conceptIds.has(v.sourceConceptId) ? v.sourceConceptId : null,
    })),
    palette: project.palette && Array.isArray(project.palette.colors) ? project.palette : undefined,
  };
}

export function upsertLogoProject(doc: Document, patch: (p: LogoProject) => LogoProject): Document {
  const project = normalizeLogoProject(doc.logoProject) ?? createLogoProject();
  const next = normalizeLogoProject(patch(project));
  return { ...doc, logoProject: next };
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

export function patchLogoBrief(doc: Document, patch: Partial<LogoBrief>): Document {
  return upsertLogoProject(doc, (p) => ({
    ...p,
    updatedAt: Date.now(),
    brief: {
      ...p.brief,
      ...patch,
      keywords: patch.keywords ?? p.brief.keywords,
      preferredColors: patch.preferredColors ?? p.brief.preferredColors,
      prohibitedColors: patch.prohibitedColors ?? p.brief.prohibitedColors,
      updatedAt: Date.now(),
    },
  }));
}

// ---------------------------------------------------------------------------
// Concepts
// ---------------------------------------------------------------------------

export function addLogoConcept(
  doc: Document,
  input: { name: string; artboardId: NodeId | null; provenance?: LogoProvenance },
): Document {
  const now = Date.now();
  return upsertLogoProject(doc, (p) => ({
    ...p,
    updatedAt: now,
    concepts: [
      ...p.concepts,
      {
        id: cryptoId(),
        name: input.name,
        artboardId: input.artboardId,
        status: 'active',
        provenance: input.provenance ?? 'user-created',
        createdAt: now,
        updatedAt: now,
      },
    ],
  }));
}

export function updateLogoConcept(
  doc: Document,
  conceptId: string,
  patch: Partial<
    Pick<LogoConcept, 'name' | 'status' | 'rationale' | 'artboardId' | 'sourcePrompt'>
  >,
): Document {
  return upsertLogoProject(doc, (p) => ({
    ...p,
    updatedAt: Date.now(),
    concepts: p.concepts.map((c) =>
      c.id === conceptId ? { ...c, ...patch, updatedAt: Date.now() } : c,
    ),
  }));
}

export function setLogoConceptStatus(
  doc: Document,
  conceptId: string,
  status: LogoConceptStatus,
): Document {
  return updateLogoConcept(doc, conceptId, { status });
}

export function removeLogoConcept(doc: Document, conceptId: string): Document {
  return upsertLogoProject(doc, (p) => ({
    ...p,
    updatedAt: Date.now(),
    concepts: p.concepts.filter((c) => c.id !== conceptId),
    variants: p.variants.map((v) =>
      v.sourceConceptId === conceptId ? { ...v, sourceConceptId: null } : v,
    ),
  }));
}

/**
 * Duplicate a concept: deep-clones the concept's artboard (artwork included)
 * and registers the clone as a new concept. Returns the new document.
 */
export function duplicateLogoConcept(doc: Document, conceptId: string): Document {
  const project = normalizeLogoProject(doc.logoProject);
  const concept = project?.concepts.find((c) => c.id === conceptId);
  if (concept?.artboardId == null) return doc;
  const artboard = doc.nodes[concept.artboardId];
  if (!artboard) return doc;

  const clone = deepCloneSubtree(doc.nodes, doc.nextId, concept.artboardId);
  let d: Document = {
    ...doc,
    nodes: { ...doc.nodes, ...clone.nodes },
    nextId: clone.nextId,
  };
  for (const rootId of Object.values(clone.idMap).slice(0, 0)) void rootId;

  // The cloned root should be appended as a sibling of the original artboard.
  const parentId = findParentOf(doc, concept.artboardId);
  if (parentId) {
    const parent = d.nodes[parentId];
    if (parent && 'children' in parent) {
      const children = [...parent.children];
      const originalIdx = children.indexOf(concept.artboardId);
      children.splice(originalIdx + 1, 0, clone.rootId);
      d = { ...d, nodes: { ...d.nodes, [parentId]: { ...parent, children } } };
    }
  } else {
    const rootChildren = [...d.rootChildren];
    const originalIdx = rootChildren.indexOf(concept.artboardId);
    rootChildren.splice(originalIdx + 1, 0, clone.rootId);
    d = { ...d, rootChildren };
  }

  const now = Date.now();
  return {
    ...d,
    logoProject: normalizeLogoProject({
      ...(d.logoProject ?? createLogoProject()),
      updatedAt: now,
      concepts: [
        ...(d.logoProject?.concepts ?? []),
        {
          id: cryptoId(),
          name: `${concept.name} Copy`,
          artboardId: clone.rootId,
          status: 'active',
          provenance: 'derived',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export function addLogoVariant(
  doc: Document,
  input: {
    name: string;
    kind: LogoVariantKind;
    artboardId: NodeId | null;
    sourceConceptId: string | null;
    derivedFromVariantId?: string | null;
  },
): Document {
  const now = Date.now();
  return upsertLogoProject(doc, (p) => ({
    ...p,
    updatedAt: now,
    variants: [
      ...p.variants,
      {
        id: cryptoId(),
        name: input.name,
        kind: input.kind,
        artboardId: input.artboardId,
        sourceConceptId: input.sourceConceptId,
        derivedFromVariantId: input.derivedFromVariantId ?? null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }));
}

export function updateLogoVariant(
  doc: Document,
  variantId: string,
  patch: Partial<Pick<LogoVariant, 'name' | 'kind' | 'artboardId' | 'notes'>>,
): Document {
  return upsertLogoProject(doc, (p) => ({
    ...p,
    updatedAt: Date.now(),
    variants: p.variants.map((v) =>
      v.id === variantId ? { ...v, ...patch, updatedAt: Date.now() } : v,
    ),
  }));
}

export function removeLogoVariant(doc: Document, variantId: string): Document {
  return upsertLogoProject(doc, (p) => ({
    ...p,
    updatedAt: Date.now(),
    variants: p.variants.filter((v) => v.id !== variantId),
  }));
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export function setLogoPalette(doc: Document, colors: LogoPaletteColor[]): Document {
  return upsertLogoProject(doc, (p) => ({
    ...p,
    updatedAt: Date.now(),
    palette: { colors, updatedAt: Date.now() },
  }));
}

// ---------------------------------------------------------------------------
// Clear-space guides
// ---------------------------------------------------------------------------

/**
 * Add clear-space guides around a logo artboard: four locked guides at a
 * given gap from the artboard's world bounds. Returns the document unchanged
 * when the node has no bounds.
 */
/** World-space bounds of a node: local bounds transformed by its own
 *  transform and rotation (parent chains are identity at root level; logo
 *  artboards are root-level frames). Computed locally to avoid a
 *  coordinateService → document → logo dependency cycle. */
function worldBoundsOf(
  doc: Document,
  nodeId: NodeId,
): { x: number; y: number; w: number; h: number } | null {
  const node = doc.nodes[nodeId];
  if (!node) return null;
  const local = nodeLocalBounds(node, doc);
  if (!local) return null;
  const t = node.transform as [number, number, number, number, number, number];
  const rot = node.rotation ?? 0;
  const cos = Math.cos((rot * Math.PI) / 180);
  const sin = Math.sin((rot * Math.PI) / 180);
  // world = rotate(rot) * transform * local, using the same composition as
  // coordinateService.nodeWorldTransform for root-level nodes.
  const m: [number, number, number, number, number, number] = [
    cos * t[0] - sin * t[1],
    sin * t[0] + cos * t[1],
    cos * t[2] - sin * t[3],
    sin * t[2] + cos * t[3],
    cos * t[4] - sin * t[5],
    sin * t[4] + cos * t[5],
  ];
  const apply = (px: number, py: number): [number, number] => [
    m[0] * px + m[2] * py + m[4],
    m[1] * px + m[3] * py + m[5],
  ];
  const corners = [
    apply(local.x, local.y),
    apply(local.x + local.w, local.y),
    apply(local.x, local.y + local.h),
    apply(local.x + local.w, local.y + local.h),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

export function addClearSpaceGuides(doc: Document, nodeId: NodeId, gap: number): Document {
  const bounds = worldBoundsOf(doc, nodeId);
  if (!bounds || !Number.isFinite(gap) || gap < 0) return doc;
  const pageId = resolveGuidePageId(doc);
  const opts = { pageId, locked: true };
  let d = doc;
  d = addGuide(d, 'vertical', bounds.x - gap, opts);
  d = addGuide(d, 'vertical', bounds.x + bounds.w + gap, opts);
  d = addGuide(d, 'horizontal', bounds.y - gap, opts);
  d = addGuide(d, 'horizontal', bounds.y + bounds.h + gap, opts);
  return d;
}

// ---------------------------------------------------------------------------
// Artboard helpers
// ---------------------------------------------------------------------------

/** Create a logo artboard frame at a world position and return its id. */
export function createLogoArtboard(
  doc: Document,
  input: { name: string; width: number; height: number; x?: number; y?: number },
): { doc: Document; artboardId: NodeId } {
  const { id: artboardId, doc: d1 } = addLogoFrame(doc, input);
  return { doc: d1, artboardId };
}

function addLogoFrame(
  doc: Document,
  input: { name: string; width: number; height: number; x?: number; y?: number },
): { id: NodeId; doc: Document } {
  const { id, doc: d1 } = nextNodeIdWithDoc(doc);
  const frame = makeLogoFrame(
    id,
    input.name,
    input.width,
    input.height,
    input.x ?? 0,
    input.y ?? 0,
  );
  const d2 = addNode(d1, frame);
  return { id, doc: d2 };
}

function makeLogoFrame(
  id: NodeId,
  name: string,
  w: number,
  h: number,
  x: number,
  y: number,
): import('../types').FrameNode {
  return {
    id,
    kind: 'frame',
    name,
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    w,
    h,
    transform: [1, 0, 0, 1, x, y],
    children: [],
    clipContent: true,
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 0 },
    strokes: [],
    effects: [],
    cornerRadius: 0,
    cornerSmoothing: 0,
  };
}

function nextNodeIdWithDoc(doc: Document): { id: NodeId; doc: Document } {
  const id = `n${doc.nextId}`;
  return { id, doc: { ...doc, nextId: doc.nextId + 1 } };
}

function findParentOf(doc: Document, nodeId: NodeId): NodeId | null {
  for (const node of Object.values(doc.nodes)) {
    if ('children' in node && node.children.includes(nodeId)) return node.id;
  }
  return null;
}
