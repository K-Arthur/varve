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
import type { ComponentDefinition, Document, NodeId, Style } from './types';

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

export function createLibrary(
  name: string,
  description = '',
  version = '0.1.0',
): Library {
  return {
    id: nextLibId(),
    name,
    description,
    version,
    components: [],
    styles: [],
    publishedAt: new Date().toISOString(),
  };
}

// ── Publishing ──────────────────────────────────────────────────────────────

/**
 * Publish a component definition to a library.
 * Bundles the component's master node data for cross-document installation.
 */
export function publishComponentToLibrary(
  library: Library,
  component: ComponentDefinition,
  doc: Document,
): { library: Library } {
  const existingIndex = library.components.findIndex((c) => c.id === component.id);
  const published: ComponentDefinition = {
    ...component,
    // Preserve the original component ID for instance tracking
  };

  const components =
    existingIndex >= 0
      ? library.components.map((c, i) => (i === existingIndex ? published : c))
      : [...library.components, published];

  return {
    library: {
      ...library,
      components,
      publishedAt: new Date().toISOString(),
    },
  };
}

/**
 * Publish a style to a library.
 */
export function publishStyleToLibrary(
  library: Library,
  style: Style,
): { library: Library } {
  const existingIndex = library.styles.findIndex((s) => s.id === style.id);
  const styles =
    existingIndex >= 0
      ? library.styles.map((s, i) => (i === existingIndex ? style : s))
      : [...library.styles, style];

  return {
    library: {
      ...library,
      styles,
      publishedAt: new Date().toISOString(),
    },
  };
}

// ── Installation ────────────────────────────────────────────────────────────

/**
 * Install a library's assets into a document.
 * Components and styles get merged into the document, preserving
 * their original IDs for referential integrity.
 */
export function installLibrary(
  doc: Document,
  library: Library,
): { doc: Document; installedComponentIds: NodeId[] } {
  const installedComponentIds: NodeId[] = [];

  // Merge components
  let components = { ...doc.components };
  for (const component of library.components) {
    components[component.id] = component;
    installedComponentIds.push(component.id);
  }

  // Merge styles
  let styles = { ...(doc.styles ?? {}) };
  for (const style of library.styles) {
    styles[style.id] = style;
  }

  // Track installed libraries
  const installedLibraries = [
    ...(doc.installedLibraries ?? []),
    { id: library.id, name: library.name, version: library.version, installedAt: new Date().toISOString() },
  ];

  return {
    doc: {
      ...doc,
      components,
      styles,
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

/**
 * List all components in a library.
 */
export function listLibraryComponents(library: Library): ComponentDefinition[] {
  return library.components;
}

/**
 * List all styles in a library.
 */
export function listLibraryStyles(library: Library): Style[] {
  return library.styles;
}

/**
 * Check if a library has updates compared to the installed version.
 */
export function hasLibraryUpdates(
  library: Library,
  installed: InstalledLibraryRef,
): boolean {
  return library.version !== installed.version;
}

/**
 * Create a transportable library package for JSON serialization.
 */
export function createLibraryPackage(
  library: Library,
  sourceDocId?: string,
): LibraryPackage {
  return {
    formatVersion: '1.0',
    library,
    exportedAt: new Date().toISOString(),
    source: sourceDocId
      ? {
          documentId: sourceDocId,
          generator: '@strata/scene/library',
          generatorVersion: '1.0',
        }
      : undefined,
  };
}
