/**
 * Library and publishing system for sharing design assets across documents.
 *
 * Libraries are bundles of components and styles that can be published,
 * versioned, and installed across documents — enabling the "Team Library"
 * pattern used by Figma and other design tools.
 *
 * Research basis: Figma Team Libraries, Penpot shared libraries,
 * Storybook publish workflow, npm package distribution model.
 */

import type { ComponentDefinition, NodeId, SceneNode, Style } from './types';
import { isContainer } from './types';

interface LibraryDoc {
  nodes: Record<NodeId, SceneNode>;
  nextId: number;
  components: Record<NodeId, ComponentDefinition>;
  styles?: Record<string, Style>;
  installedLibraries?: Array<{ id: string; name: string; version: string; installedAt: string }>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface Library {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Published component definitions. */
  components: ComponentDefinition[];
  /** Published styles (color, text, effect, layout). */
  styles: Style[];
  /** Bundled node subtrees keyed by masterRootId. */
  nodeBundles?: Record<NodeId, Record<NodeId, SceneNode>>;
  /** Timestamp of last publish. */
  publishedAt?: string;
}

/**
 * A transportable library package for cross-document sharing.
 * Serializes to/from JSON for file-based or network-based transfer.
 */
export interface LibraryPackage {
  formatVersion: string;
  library: Library;
  exportedAt: string;
  /** Source metadata for provenance tracking. */
  source?: {
    documentId?: string;
    generator: string;
    generatorVersion: string;
  };
}

// ── Factory ─────────────────────────────────────────────────────────────────

let _libIdCounter = 0;
function nextLibId(): string {
  return `lib-${++_libIdCounter}`;
}

export function createLibrary(name: string, description = '', version = '0.1.0'): Library {
  return {
    id: nextLibId(),
    name,
    description,
    version,
    components: [],
    styles: [],
    nodeBundles: {},
    publishedAt: new Date().toISOString(),
  };
}

// ── Semver helpers ──────────────────────────────────────────────────────────

function parseSemver(version: string): [number, number, number] {
  const parts = version.split('.').map((p) => Number.parseInt(p, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareSemver(a: string, b: string): number {
  const [ma, mi, pa] = parseSemver(a);
  const [mb, mj, pb] = parseSemver(b);
  if (ma !== mb) return ma - mb;
  if (mi !== mj) return mi - mj;
  return pa - pb;
}

function bumpPatchVersion(version: string): string {
  const [major, minor, patch] = parseSemver(version);
  return `${major}.${minor}.${patch + 1}`;
}

function collectSubtree(doc: LibraryDoc, rootId: NodeId): Record<NodeId, SceneNode> {
  const result: Record<NodeId, SceneNode> = {};

  function walk(id: NodeId) {
    const node = doc.nodes[id];
    if (!node) return;
    result[id] = node;
    if (isContainer(node)) {
      for (const childId of node.children) {
        walk(childId);
      }
    }
  }

  walk(rootId);
  return result;
}

function remapSubtree(
  subtree: Record<NodeId, SceneNode>,
  doc: LibraryDoc,
): { nodes: Record<NodeId, SceneNode>; idMap: Map<NodeId, NodeId>; nextId: number } {
  const idMap = new Map<NodeId, NodeId>();
  let nextId = doc.nextId;
  const nodes: Record<NodeId, SceneNode> = {};

  for (const oldId of Object.keys(subtree)) {
    const newId = `n${nextId++}`;
    idMap.set(oldId, newId);
  }

  for (const [oldId, node] of Object.entries(subtree)) {
    const newId = idMap.get(oldId);
    if (!newId) continue;
    let cloned: SceneNode = { ...node, id: newId };

    if (isContainer(node)) {
      cloned = {
        ...cloned,
        children: node.children
          .map((cid) => idMap.get(cid))
          .filter((cid): cid is NodeId => cid !== undefined),
      } as SceneNode;
    }

    nodes[newId] = cloned;
  }

  return { nodes, idMap, nextId };
}

// ── Publishing ──────────────────────────────────────────────────────────────

/**
 * Publish a component definition to a library.
 * Bundles the component's master node subtree for cross-document installation.
 */
export function publishComponentToLibrary(
  library: Library,
  component: ComponentDefinition,
  doc: LibraryDoc,
): { library: Library } {
  const existingIndex = library.components.findIndex((c) => c.id === component.id);
  const published: ComponentDefinition = { ...component };
  const subtree = collectSubtree(doc, component.masterRootId);

  const components =
    existingIndex >= 0
      ? library.components.map((c, i) => (i === existingIndex ? published : c))
      : [...library.components, published];

  const nodeBundles = { ...(library.nodeBundles ?? {}), [component.masterRootId]: subtree };

  return {
    library: {
      ...library,
      components,
      nodeBundles,
      version: bumpPatchVersion(library.version),
      publishedAt: new Date().toISOString(),
    },
  };
}

/**
 * Publish a style to a library.
 */
export function publishStyleToLibrary(library: Library, style: Style): { library: Library } {
  const existingIndex = library.styles.findIndex((s) => s.id === style.id);
  const styles =
    existingIndex >= 0
      ? library.styles.map((s, i) => (i === existingIndex ? style : s))
      : [...library.styles, style];

  return {
    library: {
      ...library,
      styles,
      version: bumpPatchVersion(library.version),
      publishedAt: new Date().toISOString(),
    },
  };
}

// ── Installation ────────────────────────────────────────────────────────────

/**
 * Install a library's assets into a document.
 * Clones bundled node subtrees with ID remapping for referential integrity.
 */
export function installLibrary(
  doc: LibraryDoc,
  library: Library,
): { doc: LibraryDoc; installedComponentIds: NodeId[] } {
  const installedComponentIds: NodeId[] = [];
  let workingDoc = doc;

  const components = { ...doc.components };
  const styles = { ...(doc.styles ?? {}) };
  let allNewNodes: Record<NodeId, SceneNode> = {};

  for (const component of library.components) {
    components[component.id] = component;
    installedComponentIds.push(component.id);

    const bundle = library.nodeBundles?.[component.masterRootId];
    if (bundle) {
      const { nodes, idMap, nextId } = remapSubtree(bundle, workingDoc);
      allNewNodes = { ...allNewNodes, ...nodes };
      workingDoc = { ...workingDoc, nextId };

      const newMasterRootId = idMap.get(component.masterRootId);
      if (newMasterRootId) {
        components[component.id] = { ...component, masterRootId: newMasterRootId };
      }
    }
  }

  for (const style of library.styles) {
    styles[style.id] = style;
  }

  const existingIdx = (workingDoc.installedLibraries ?? []).findIndex((l) => l.id === library.id);
  const installedRef = {
    id: library.id,
    name: library.name,
    version: library.version,
    installedAt: new Date().toISOString(),
  };
  const installedLibraries =
    existingIdx >= 0
      ? (workingDoc.installedLibraries ?? []).map((l, i) => (i === existingIdx ? installedRef : l))
      : [...(workingDoc.installedLibraries ?? []), installedRef];

  return {
    doc: {
      ...workingDoc,
      components,
      styles,
      nodes: { ...workingDoc.nodes, ...allNewNodes },
      installedLibraries,
    },
    installedComponentIds,
  };
}

/**
 * Interface for tracking installed library metadata on a document.
 */
export interface InstalledLibraryRef {
  id: string;
  name: string;
  version: string;
  installedAt: string;
}

// ── Query ───────────────────────────────────────────────────────────────────

export function listLibraryComponents(library: Library): ComponentDefinition[] {
  return library.components;
}

export function listLibraryStyles(library: Library): Style[] {
  return library.styles;
}

/**
 * Check if a library has updates compared to the installed version (semver).
 */
export function hasLibraryUpdates(library: Library, installed: InstalledLibraryRef): boolean {
  return compareSemver(library.version, installed.version) > 0;
}

/**
 * Create a transportable library package for JSON serialization.
 */
export function createLibraryPackage(library: Library, sourceDocId?: string): LibraryPackage {
  return {
    formatVersion: '1.0',
    library,
    exportedAt: new Date().toISOString(),
    source: sourceDocId
      ? {
          documentId: sourceDocId,
          generator: '@varve/scene/library',
          generatorVersion: '1.0',
        }
      : undefined,
  };
}
