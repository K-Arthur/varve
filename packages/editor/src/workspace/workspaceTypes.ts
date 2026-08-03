/**
 * Workspace mode types — versioned, typed configuration over the same editor shell.
 *
 * A workspace mode controls which panels are shown, their order and collapsed
 * state, toolbar composition, default tools, canvas overlays, status-bar
 * sections, inspector tabs, shortcut layers, and performance preferences.
 *
 * A workspace mode does NOT:
 * - Fork the scene model or document
 * - Duplicate commands or tools
 * - Mutate artwork merely by being activated
 * - Recreate the renderer
 * - Reset document state, undo/redo, or selection
 * - Hide save, recovery, undo, or workspace-exit actions
 * - Make useful tools permanently inaccessible
 */

import type { WorkspaceMode } from '@strata/shared';
import type { IconName } from '@strata/ui';
import type { ToolId } from '../tools/types';

// ---------------------------------------------------------------------------
// Workspace mode identity
// ---------------------------------------------------------------------------

/**
 * Canonical definition lives in @strata/shared (the lowest layer both scene
 * and editor depend on) — re-exported here so existing
 * `from '../workspace/workspaceTypes'` imports keep working. Do not
 * redeclare this locally; it drifted out of sync with scene's copy once
 * before ('codegen' missing there) and caused real cross-package typecheck
 * failures.
 */
export type { WorkspaceMode };

// ---------------------------------------------------------------------------
// Panel configuration
// ---------------------------------------------------------------------------

export type PanelId = 'layers' | 'inspector' | 'timeline' | 'pagenav' | 'library' | 'codegen';

export interface PanelConfig {
  /** Whether this panel is visible by default in this mode. */
  visible: boolean;
  /** Whether this panel starts collapsed (zero-width). */
  collapsed: boolean;
  /** Panel position in the sidebar ordering (lower = closer to canvas). */
  order: number;
  /** Preferred width as a CSS value (e.g. '16rem', '240px'). */
  preferredWidth?: string;
}

export type PanelLayout = Record<PanelId, PanelConfig>;

// ---------------------------------------------------------------------------
// Toolbar composition
// ---------------------------------------------------------------------------

export interface ToolbarItem {
  toolId: ToolId;
  /** Whether this tool starts a visual group (separator before it). */
  groupStart?: boolean;
}

export interface ToolbarConfig {
  /** Tools shown in the floating toolbar for this mode. */
  tools: ToolbarItem[];
  /** Tool groups for flyout menus (e.g. shapes, boolean ops). */
  flyouts?: {
    id: string;
    label: string;
    tools: ToolId[];
  }[];
}

// ---------------------------------------------------------------------------
// Inspector tab configuration
// ---------------------------------------------------------------------------

export type InspectorTabGroup = 'primary' | 'workflow' | 'output';

export type InspectorTabId =
  | 'properties'
  | 'appearance'
  | 'adjustments'
  | 'prototype'
  | 'export'
  | 'audit'
  | 'codegen'
  | 'fonts';

/** Legacy tab IDs that may appear in stored preferences — mapped on migration. */
export type DeprecatedInspectorTabId = 'document' | 'spec';

export interface InspectorTabConfig {
  id: InspectorTabId;
  label: string;
  visible: boolean;
  /** Visual group for tab bar separators. Defaults to 'workflow'. */
  group?: InspectorTabGroup;
  /** Whether this tab is the default when switching to this mode. */
  default?: boolean;
  /**
   * Overflow priority — when tabs exceed container width, tabs with higher
   * overflow priority are moved to the overflow menu first. 0 = pinned
   * (never overflows). Defaults to 1.
   */
  overflowPriority?: number;
}

// ---------------------------------------------------------------------------
// Status bar configuration
// ---------------------------------------------------------------------------

export type StatusSectionId =
  | 'toolName'
  | 'cursorPos'
  | 'zoom'
  | 'selectionInfo'
  | 'unit'
  | 'preflight'
  | 'debt'
  | 'layoutScore'
  | 'colorMode'
  | 'imageInfo'
  | 'pageInfo'
  | 'shortcutTip';

export interface StatusSectionConfig {
  id: StatusSectionId;
  visible: boolean;
  /** Display order (lower = left). */
  order: number;
}

// ---------------------------------------------------------------------------
// Canvas overlay configuration
// ---------------------------------------------------------------------------

export interface CanvasOverlayConfig {
  rulers: boolean;
  guides: boolean;
  pixelGrid: boolean;
  dotGrid: boolean;
  /** Show bleed/trim/slug guides (print mode). */
  bleedGuides: boolean;
  /** Show layout grid overlays. */
  layoutGrid: boolean;
  /** Show baseline grid. */
  baselineGrid: boolean;
}

// ---------------------------------------------------------------------------
// Keyboard shortcut layers
// ---------------------------------------------------------------------------

export interface ShortcutLayer {
  /** Extra shortcut bindings active only in this mode. */
  extra?: Record<string, string>;
  /** Shortcuts disabled in this mode (global shortcuts still work). */
  disabled?: string[];
}

// ---------------------------------------------------------------------------
// Performance preferences
// ---------------------------------------------------------------------------

export interface PerformanceConfig {
  /** Enable worker-based rendering for non-structural scenes. */
  useWorkerRenderer: boolean;
  /** Enable subtree IR caching. */
  useSubtreeCache: boolean;
  /** Enable viewport culling. */
  viewportCulling: boolean;
  /** Maximum decoded image cache entries. */
  imageCacheSize: number;
  /** Enable thumbnails in layers panel. */
  layerThumbnails: boolean;
  /** Enable real-time preview during slider drags (vs. debounced). */
  realTimePreview: boolean;
}

// ---------------------------------------------------------------------------
// Mode-specific onboarding
// ---------------------------------------------------------------------------

export interface OnboardingConfig {
  /** Short description shown in workspace switcher tooltip. */
  description: string;
  /** Keyboard shortcut hint for switching to this mode. */
  shortcutHint: string;
  /** Tips shown on first switch to this mode. */
  tips?: string[];
}

// ---------------------------------------------------------------------------
// Full workspace configuration
// ---------------------------------------------------------------------------

export interface WorkspaceConfig {
  /** Schema version for safe migration. */
  version: number;
  /** Which panels are visible and how they're arranged. */
  panels: PanelLayout;
  /** Tool to activate when switching to this mode (undefined = preserve current). */
  defaultTool?: ToolId;
  /** Toolbar composition for this mode. */
  toolbar: ToolbarConfig;
  /** Inspector tab configuration. */
  inspectorTabs: InspectorTabConfig[];
  /** Status bar section configuration. */
  statusSections: StatusSectionConfig[];
  /** Canvas overlays active by default. */
  canvasOverlays: CanvasOverlayConfig;
  /** Keyboard shortcut layer. */
  shortcuts: ShortcutLayer;
  /** Performance preferences. */
  performance: PerformanceConfig;
  /** Onboarding and mode metadata. */
  onboarding: OnboardingConfig;
  /** Show the floating toolbar. */
  floatingToolbar: boolean;
  /** Show the status bar. */
  statusBar: boolean;
  /** Show the menubar tab strip (multi-doc tabs). */
  tabStrip: boolean;
}

// ---------------------------------------------------------------------------
// Workspace preference (user-customizable, persisted)
// ---------------------------------------------------------------------------

export interface WorkspacePreference {
  /** Mode-specific panel overrides. */
  panelOverrides?: Partial<Record<PanelId, Partial<PanelConfig>>>;
  /** Whether the user has customized this mode. */
  customized: boolean;
  /** Timestamp of last customization. */
  lastCustomized?: number;
}

export type WorkspacePreferences = Record<WorkspaceMode, WorkspacePreference>;

// ---------------------------------------------------------------------------
// Mode switching state snapshot (for safe switching during interactions)
// ---------------------------------------------------------------------------

export interface WorkspaceSnapshot {
  /** The mode being switched from. */
  previousMode: WorkspaceMode;
  /** The mode being switched to. */
  nextMode: WorkspaceMode;
  /** Timestamp of the switch. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Built-in workspace configurations
// ---------------------------------------------------------------------------

const COMMON_PERFORMANCE: PerformanceConfig = {
  useWorkerRenderer: true,
  useSubtreeCache: true,
  viewportCulling: true,
  imageCacheSize: 200,
  layerThumbnails: true,
  realTimePreview: true,
};

export const WORKSPACE_CONFIGS: Record<WorkspaceMode, WorkspaceConfig> = {
  // ─── Design Mode (UI/UX, components, prototyping) ──────────────────────
  design: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0 },
      inspector: { visible: true, collapsed: false, order: 0 },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: true, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
    },
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'rect', groupStart: true },
        { toolId: 'ellipse' },
        { toolId: 'polygon' },
        { toolId: 'star' },
        { toolId: 'line', groupStart: true },
        { toolId: 'arrow' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'text', groupStart: true },
        { toolId: 'frame' },
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'slice' },
        { toolId: 'eyedropper' },
        { toolId: 'scale' },
        { toolId: 'inspect' },
      ],
      flyouts: [
        { id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse', 'polygon', 'star'] },
        {
          id: 'boolean',
          label: 'Boolean',
          tools: ['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanExclude'],
        },
      ],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'prototype', label: 'Prototype', visible: true, group: 'workflow' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'audit', label: 'Audit', visible: true, group: 'output', overflowPriority: 5 },
      { id: 'fonts', label: 'Fonts', visible: true, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'layoutScore', visible: true, order: 11 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'debt', visible: true, order: 21 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    shortcuts: { extra: {}, disabled: [] },
    performance: { ...COMMON_PERFORMANCE },
    onboarding: {
      description:
        'UI/UX design, components, tokens, responsive layouts, prototyping, and developer handoff.',
      shortcutHint: 'Ctrl+Shift+D',
      tips: [
        'Use Frame (F) to create artboards and responsive containers.',
        'Create components with Ctrl+K, then use variants for state changes.',
        'Switch to Prototype mode (Ctrl+Alt+P) to add interactions.',
        'Use Inspect (hold Ctrl) to measure and copy design specs.',
      ],
    },
  },

  // ─── Print Mode (multi-page, typography, preflight, production) ─────────
  print: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0 },
      inspector: { visible: true, collapsed: false, order: 0 },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: true, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
    },
    defaultTool: 'select',
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'rect', groupStart: true },
        { toolId: 'ellipse' },
        { toolId: 'polygon' },
        { toolId: 'star' },
        { toolId: 'line', groupStart: true },
        { toolId: 'arrow' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'text', groupStart: true },
        { toolId: 'frame' },
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'slice' },
        { toolId: 'eyedropper' },
        { toolId: 'scale' },
        { toolId: 'inspect' },
      ],
      flyouts: [
        { id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse', 'polygon', 'star'] },
        {
          id: 'boolean',
          label: 'Boolean',
          tools: ['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanExclude'],
        },
      ],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'audit', label: 'Audit', visible: true, group: 'output', overflowPriority: 5 },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'fonts', label: 'Fonts', visible: true, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'pageInfo', visible: true, order: 5 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'preflight', visible: true, order: 12 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'colorMode', visible: true, order: 22 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: true,
      layoutGrid: false,
      baselineGrid: false,
    },
    shortcuts: {
      extra: {
        'Ctrl+Shift+P': 'toggleFacingPages',
        'Ctrl+Alt+M': 'createMaster',
      },
      disabled: [],
    },
    performance: { ...COMMON_PERFORMANCE },
    onboarding: {
      description:
        'Multi-page layouts, typography, preflight, colour management, and production output.',
      shortcutHint: 'Ctrl+Shift+P',
      tips: [
        'Use Page Nav (bottom strip) to add, reorder, and navigate pages.',
        'Toggle Facing Pages in the View menu for book/magazine layouts.',
        'Master pages (Page menu) let you reuse headers, footers, and page numbers.',
        'Preflight warnings appear in the status bar when issues are detected.',
        'Export to PDF/X for print production via File → Export.',
      ],
    },
  },

  // ─── Drawing/Painting Mode (canvas-first, brushes, stylus) ──────────────
  drawing: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0 },
      inspector: { visible: true, collapsed: false, order: 0 },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: false, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
    },
    defaultTool: 'paint',
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'paint', groupStart: true },
        { toolId: 'eraser' },
        { toolId: 'smudge' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'line' },
        { toolId: 'arrow' },
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'text' },
        { toolId: 'eyedropper' },
        { toolId: 'frame' },
      ],
      flyouts: [
        {
          id: 'retouch',
          label: 'Retouch',
          tools: ['cloneStamp', 'healBrush', 'spotHeal', 'patch'],
        },
      ],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'fonts', label: 'Fonts', visible: false, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'debt', visible: true, order: 21 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: false,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    shortcuts: {
      extra: {
        'Shift+P': 'toolPencil',
        A: 'toolArrow',
      },
      disabled: [],
    },
    performance: {
      ...COMMON_PERFORMANCE,
      realTimePreview: true,
      layerThumbnails: true,
    },
    onboarding: {
      description:
        'Raster painting, vector freehand drawing, stylus input, brushes, masks, and drawing assists.',
      shortcutHint: 'Ctrl+Shift+R',
      tips: [
        'Press B for the Brush tool. Use [ and ] to resize.',
        'Hold Shift while drawing for straight lines.',
        'Right-click (or Alt+click) for the color picker.',
        'Use Ctrl+Shift+F for distraction-free canvas mode.',
        'Pressure and tilt are mapped when using a stylus.',
      ],
    },
  },

  // ─── Image Editing Mode (photo editing, retouching, adjustments) ────────
  image: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0 },
      inspector: { visible: true, collapsed: false, order: 0 },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: false, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
    },
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'crop', groupStart: true },
        { toolId: 'eyedropper' },
        { toolId: 'paint', groupStart: true },
        { toolId: 'eraser' },
        { toolId: 'smudge' },
        { toolId: 'cloneStamp', groupStart: true },
        { toolId: 'healBrush' },
        { toolId: 'spotHeal' },
        { toolId: 'patch' },
        { toolId: 'refineMask', groupStart: true },
        { toolId: 'trimapEdit' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'line' },
        { toolId: 'text' },
        { toolId: 'scale' },
        { toolId: 'inspect' },
      ],
      flyouts: [
        {
          id: 'retouch',
          label: 'Retouch',
          tools: ['cloneStamp', 'healBrush', 'spotHeal', 'patch'],
        },
        { id: 'mask', label: 'Mask', tools: ['refineMask', 'trimapEdit'] },
      ],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'adjustments', label: 'Adjustments', visible: true, group: 'workflow' },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'audit', label: 'Audit', visible: true, group: 'output', overflowPriority: 5 },
      { id: 'fonts', label: 'Fonts', visible: false, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'imageInfo', visible: true, order: 5 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'colorMode', visible: true, order: 22 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: true,
      dotGrid: false,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    shortcuts: {
      extra: {
        'Ctrl+Y': 'toggleSoftProof',
        'Ctrl+Shift+Y': 'toggleBeforeAfter',
        Q: 'enterQuickMask',
      },
      disabled: [],
    },
    performance: {
      ...COMMON_PERFORMANCE,
      realTimePreview: true,
      imageCacheSize: 300,
    },
    onboarding: {
      description:
        'Nondestructive photo editing, retouching, selections, adjustments, masking, and compositing.',
      shortcutHint: 'Ctrl+Shift+I',
      tips: [
        'Use adjustment layers (nondestructive) instead of direct edits.',
        'Press Q for Quick Mask mode to paint selections.',
        'Ctrl+Y toggles soft proofing for print colour accuracy.',
        'Ctrl+Shift+Y shows before/after comparison.',
        'Background removal (Ctrl+Shift+B) uses AI subject detection.',
      ],
    },
  },

  // ─── Motion Mode (animation, timeline, keyframes, prototyping) ──────────
  // ─── Codegen & Audit Mode (design-to-code, design audit, spec output) ────
  codegen: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0, preferredWidth: '16rem' },
      inspector: { visible: true, collapsed: false, order: 0, preferredWidth: '20rem' },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: true, collapsed: false, order: 3 },
      library: { visible: true, collapsed: false, order: 4 },
      codegen: { visible: true, collapsed: false, order: 5, preferredWidth: '100%' },
    },
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'inspect', groupStart: true },
        { toolId: 'frame', groupStart: true },
        { toolId: 'rect' },
        { toolId: 'ellipse' },
        { toolId: 'text' },
        { toolId: 'line', groupStart: true },
        { toolId: 'arrow' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'scale', groupStart: true },
        { toolId: 'eyedropper' },
      ],
      flyouts: [
        { id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse'] },
        {
          id: 'boolean',
          label: 'Boolean',
          tools: ['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanExclude'],
        },
      ],
    },
    inspectorTabs: [
      {
        id: 'codegen',
        label: 'Codegen',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        group: 'primary',
        overflowPriority: 1,
      },
      { id: 'audit', label: 'Audit', visible: true, group: 'output' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'fonts', label: 'Fonts', visible: false, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'layoutScore', visible: true, order: 11 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'debt', visible: true, order: 21 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    shortcuts: { extra: {}, disabled: [] },
    // Codegen mode is text/spec output, not heavy canvas rendering -- no worker
    // renderer needed (see workspaceTypes.test.ts).
    performance: { ...COMMON_PERFORMANCE, useWorkerRenderer: false },
    onboarding: {
      description:
        'Design-to-code export, design audit, accessibility checks, and specification output.',
      shortcutHint: 'Ctrl+Shift+9',
      tips: [
        'Select a node to view its code in HTML, Tailwind, or SVG.',
        'Use the Audit tab to check contrast, typography, and accessibility.',
        'The Design Audit report lists all issues with severity levels.',
        'Switch between codegen targets to compare output formats.',
        'Flattened regions show fidelity warnings where effects are rasterized.',
      ],
    },
  },

  // ─── Logo Mode (wordmarks, marks, monograms, brand systems) ─────────────
  logo: {
    version: 1,
    panels: {
      layers: { visible: true, collapsed: false, order: 0 },
      inspector: { visible: true, collapsed: false, order: 0 },
      timeline: { visible: false, collapsed: false, order: 2 },
      pagenav: { visible: false, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
    },
    defaultTool: 'select',
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'select', groupStart: true },
        { toolId: 'lasso' },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'nodeEdit' },
        { toolId: 'text', groupStart: true },
        { toolId: 'frame', groupStart: true },
        { toolId: 'rect' },
        { toolId: 'ellipse' },
        { toolId: 'polygon' },
        { toolId: 'star' },
        { toolId: 'line', groupStart: true },
        { toolId: 'arrow' },
        { toolId: 'scale', groupStart: true },
        { toolId: 'eyedropper' },
        { toolId: 'inspect' },
      ],
      flyouts: [
        { id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse', 'polygon', 'star'] },
        {
          id: 'boolean',
          label: 'Boolean',
          tools: ['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanExclude'],
        },
      ],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'audit', label: 'Audit', visible: true, group: 'output', overflowPriority: 5 },
      { id: 'fonts', label: 'Fonts', visible: true, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'layoutScore', visible: true, order: 11 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'debt', visible: true, order: 21 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
      { id: 'selectionInfo', visible: true, order: 40 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    shortcuts: { extra: {}, disabled: [] },
    performance: { ...COMMON_PERFORMANCE },
    onboarding: {
      description:
        'Logo design: wordmarks, marks, monograms, badges, clear-space, and brand systems on a transparent canvas.',
      shortcutHint: 'Ctrl+Shift+6',
      tips: [
        'Logo canvases start transparent — export keeps alpha.',
        'Use Convert Text to Outlines (Text menu) before delivering final wordmarks.',
        'Boolean tools (Ctrl+Alt+U/S/I/X) combine shapes into a single mark.',
        'Generate clear-space guides from Object menu to protect the logo.',
        'Audit tab flags thin strokes, unclosed paths, and small-size risks.',
      ],
    },
  },

  motion: {
    version: 2,
    panels: {
      layers: { visible: true, collapsed: false, order: 0, preferredWidth: '18rem' },
      inspector: { visible: true, collapsed: false, order: 0, preferredWidth: '18rem' },
      timeline: { visible: true, collapsed: false, order: 2, preferredWidth: '100%' },
      pagenav: { visible: true, collapsed: false, order: 3 },
      library: { visible: false, collapsed: false, order: 4 },
      codegen: { visible: false, collapsed: false, order: 5 },
    },
    defaultTool: 'select',
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    toolbar: {
      tools: [
        { toolId: 'select', groupStart: true },
        { toolId: 'hand' },
        { toolId: 'zoom' },
        { toolId: 'frame', groupStart: true },
        { toolId: 'rect' },
        { toolId: 'ellipse' },
        { toolId: 'text' },
        { toolId: 'pen', groupStart: true },
        { toolId: 'pencil' },
        { toolId: 'line' },
        { toolId: 'arrow' },
        { toolId: 'scale', groupStart: true },
        { toolId: 'eyedropper' },
        { toolId: 'inspect' },
      ],
      flyouts: [{ id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse'] }],
    },
    inspectorTabs: [
      {
        id: 'properties',
        label: 'Properties',
        visible: true,
        default: true,
        group: 'primary',
        overflowPriority: 0,
      },
      { id: 'appearance', label: 'Appearance & Effects', visible: true, group: 'workflow' },
      { id: 'prototype', label: 'Prototype', visible: true, group: 'workflow' },
      { id: 'export', label: 'Export', visible: true, group: 'output' },
      { id: 'audit', label: 'Audit', visible: true, group: 'output', overflowPriority: 5 },
      { id: 'fonts', label: 'Fonts', visible: false, group: 'workflow' },
    ],
    statusSections: [
      { id: 'toolName', visible: true, order: 0 },
      { id: 'cursorPos', visible: true, order: 10 },
      { id: 'layoutScore', visible: true, order: 11 },
      { id: 'selectionInfo', visible: true, order: 12 },
      { id: 'unit', visible: true, order: 20 },
      { id: 'debt', visible: true, order: 21 },
      { id: 'shortcutTip', visible: true, order: 25 },
      { id: 'zoom', visible: true, order: 30 },
    ],
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
      bleedGuides: false,
      layoutGrid: false,
      baselineGrid: false,
    },
    shortcuts: {
      extra: {
        G: 'toggleGraphEditor',
        Space: 'playPause',
        'Alt+O': 'toggleOnionSkin',
        'Alt+P': 'addPositionKeyframe',
        'Alt+R': 'addRotationKeyframe',
        'Alt+S': 'addScaleKeyframe',
        'Alt+E': 'addOpacityKeyframe',
        'Alt+K': 'toggleAutoKeyframe',
      },
      disabled: [],
    },
    performance: {
      ...COMMON_PERFORMANCE,
      realTimePreview: true,
      useSubtreeCache: true,
    },
    onboarding: {
      description:
        'Timeline-based animation, keyframe editing, easing curves, motion paths, and interactive prototyping.',
      shortcutHint: 'Ctrl+Shift+M',
      tips: [
        'Press I to add a keyframe at the playhead for the selected property.',
        'Press O to toggle onion skinning — see previous/next frame ghosts.',
        'Press G to open the Graph Editor for easing curves.',
        'Space toggles play/pause of the active timeline.',
        'Auto-keyframe mode (K) inserts keyframes when you edit properties during playback.',
        'Motion path shows on canvas — drag keyframe points to adjust timing.',
        'Right-click a keyframe to change easing (linear, ease, spring, bezier).',
        'Create multiple timelines to organize complex animations.',
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Schema version for safe migration. */
export const WORKSPACE_CONFIG_VERSION = 1;

export function getWorkspaceConfig(mode: WorkspaceMode): WorkspaceConfig {
  return WORKSPACE_CONFIGS[mode] ?? WORKSPACE_CONFIGS.design;
}

export const WORKSPACE_LABELS: Record<WorkspaceMode, string> = {
  design: 'Design',
  print: 'Print',
  drawing: 'Draw',
  image: 'Photo',
  motion: 'Motion',
  codegen: 'Codegen & Audit',
  logo: 'Logo',
};

export const WORKSPACE_ICONS: Record<WorkspaceMode, IconName> = {
  design: 'PenTool',
  print: 'Printer',
  drawing: 'Paintbrush',
  image: 'Image',
  motion: 'Play',
  codegen: 'Code',
  logo: 'Stamp',
};

/** All available workspace modes. */
export const ALL_WORKSPACE_MODES: readonly WorkspaceMode[] = [
  'design',
  'print',
  'drawing',
  'image',
  'motion',
  'codegen',
  'logo',
] as const;

/** Mode-specific keyboard shortcuts for switching. */
export const WORKSPACE_SHORTCUTS: Record<WorkspaceMode, string> = {
  design: 'Ctrl+Shift+D',
  print: 'Ctrl+Shift+P',
  drawing: 'Ctrl+Shift+R',
  image: 'Ctrl+Shift+I',
  motion: 'Ctrl+Shift+M',
  codegen: 'Ctrl+Shift+9',
  logo: 'Ctrl+Shift+6',
};

// ---------------------------------------------------------------------------
// Panel layout helpers
// ---------------------------------------------------------------------------

/** Get panels sorted by their order value for a given mode. */
export function getOrderedPanels(mode: WorkspaceMode): PanelId[] {
  const config = getWorkspaceConfig(mode);
  return (Object.entries(config.panels) as [PanelId, PanelConfig][])
    .filter(([_, p]) => p.visible)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([id]) => id);
}

/** Get visible status sections sorted by order. */
export function getVisibleStatusSections(mode: WorkspaceMode): StatusSectionId[] {
  const config = getWorkspaceConfig(mode);
  return config.statusSections
    .filter((s) => s.visible)
    .sort((a, b) => a.order - b.order)
    .map((s) => s.id);
}

/** Get visible inspector tabs for a mode. */
export function getVisibleInspectorTabs(mode: WorkspaceMode): InspectorTabId[] {
  const config = getWorkspaceConfig(mode);
  return config.inspectorTabs.filter((t) => t.visible).map((t) => t.id);
}

/** Get the default inspector tab for a mode. */
export function getDefaultInspectorTab(mode: WorkspaceMode): InspectorTabId {
  const config = getWorkspaceConfig(mode);
  return config.inspectorTabs.find((t) => t.default)?.id ?? 'properties';
}

/** Get inspector tab configs grouped by visual group, preserving per-group order. */
export function getGroupedInspectorTabs(
  mode: WorkspaceMode,
): Partial<Record<InspectorTabGroup, InspectorTabConfig[]>> {
  const config = getWorkspaceConfig(mode);
  const groups: Partial<Record<InspectorTabGroup, InspectorTabConfig[]>> = {};
  for (const tab of config.inspectorTabs) {
    if (!tab.visible) continue;
    const g = tab.group ?? 'workflow';
    if (!groups[g]) groups[g] = [];
    groups[g]!.push(tab);
  }
  return groups;
}

/** Tab group display labels. */
export const TAB_GROUP_LABELS: Record<InspectorTabGroup, string> = {
  primary: 'Properties',
  workflow: 'Workflow',
  output: 'Output',
};

/** Order of tab groups in the tab bar. */
export const TAB_GROUP_ORDER: InspectorTabGroup[] = ['primary', 'workflow', 'output'];

/**
 * Labelled fallback for deprecated tab IDs that still appear in stored prefs or
 * external callers. These should be resolved by migration but can appear in
 * transient state (e.g. a stored activeTab from a previous session).
 */
export const DEPRECATED_TAB_FALLBACKS: Record<string, InspectorTabId> = {
  document: 'properties',
  spec: 'export',
};

/** Get tools that should be hidden in a given mode. */
export function getHiddenTools(mode: WorkspaceMode): Set<ToolId> {
  const config = getWorkspaceConfig(mode);
  const toolbarToolIds = new Set(config.toolbar.tools.map((t) => t.toolId));
  // Tools in the full tool set that aren't in the mode's toolbar are hidden
  const ALL_TOOLS: ToolId[] = [
    'select',
    'frame',
    'rect',
    'ellipse',
    'polygon',
    'star',
    'line',
    'arrow',
    'pen',
    'pencil',
    'nodeEdit',
    'text',
    'hand',
    'zoom',
    'scale',
    'image',
    'slice',
    'eyedropper',
    'inspect',
    'booleanUnion',
    'booleanSubtract',
    'booleanIntersect',
    'booleanExclude',
    'cloneStamp',
    'healBrush',
    'spotHeal',
    'patch',
    'refineMask',
    'trimapEdit',
    'crop',
    'paint',
    'eraser',
    'smudge',
    'lasso',
  ];
  const hidden = new Set<ToolId>();
  for (const id of ALL_TOOLS) {
    if (!toolbarToolIds.has(id)) hidden.add(id);
  }
  return hidden;
}

/** Check if a mode config is valid (has required fields). */
export function isValidWorkspaceConfig(config: unknown): config is WorkspaceConfig {
  if (typeof config !== 'object' || config === null) return false;
  const c = config as Record<string, unknown>;
  return (
    typeof c.version === 'number' &&
    typeof c.floatingToolbar === 'boolean' &&
    typeof c.statusBar === 'boolean' &&
    typeof c.tabStrip === 'boolean' &&
    typeof c.panels === 'object' &&
    c.panels !== null &&
    typeof c.toolbar === 'object' &&
    c.toolbar !== null &&
    Array.isArray(c.inspectorTabs) &&
    Array.isArray(c.statusSections) &&
    typeof c.canvasOverlays === 'object' &&
    c.canvasOverlays !== null
  );
}

/** Migrate an older config to the current version. */
export function migrateWorkspaceConfig(
  config: Record<string, unknown>,
  _targetVersion: number = WORKSPACE_CONFIG_VERSION,
): WorkspaceConfig {
  // Version 0 → 1: upgrade from the old WorkspaceConfig shape
  if (!config.version || (config.version as number) < 1) {
    const old = config as unknown as {
      visiblePanels?: {
        layers?: boolean;
        inspector?: boolean;
        timeline?: boolean;
        pagenav?: boolean;
        library?: boolean;
      };
      defaultTool?: string;
      floatingToolbar?: boolean;
      statusBar?: boolean;
      tabStrip?: boolean;
      canvasOverlays?: {
        rulers?: boolean;
        guides?: boolean;
        pixelGrid?: boolean;
        dotGrid?: boolean;
      };
      statusSections?: {
        toolName?: boolean;
        cursorPos?: boolean;
        zoom?: boolean;
        selectionInfo?: boolean;
        unit?: boolean;
        preflight?: boolean;
        debt?: boolean;
      };
    };

    const mode = (config._mode as WorkspaceMode) ?? 'design';
    const base = getWorkspaceConfig(mode);

    const panels: PanelLayout = {
      layers: { visible: old.visiblePanels?.layers ?? true, collapsed: false, order: 0 },
      inspector: { visible: old.visiblePanels?.inspector ?? true, collapsed: false, order: 0 },
      timeline: { visible: old.visiblePanels?.timeline ?? false, collapsed: false, order: 2 },
      pagenav: { visible: old.visiblePanels?.pagenav ?? true, collapsed: false, order: 3 },
      library: { visible: old.visiblePanels?.library ?? false, collapsed: false, order: 4 },
      // Didn't exist in the pre-v1 format (like bleedGuides/layoutGrid/baselineGrid below) --
      // fall back to the target mode's own default rather than inventing a literal.
      codegen: base.panels.codegen,
    };

    return {
      ...base,
      version: 1,
      panels,
      defaultTool: old.defaultTool as ToolId | undefined,
      floatingToolbar: old.floatingToolbar ?? true,
      statusBar: old.statusBar ?? true,
      tabStrip: old.tabStrip ?? true,
      canvasOverlays: {
        rulers: old.canvasOverlays?.rulers ?? true,
        guides: old.canvasOverlays?.guides ?? true,
        pixelGrid: old.canvasOverlays?.pixelGrid ?? false,
        dotGrid: old.canvasOverlays?.dotGrid ?? true,
        bleedGuides: base.canvasOverlays.bleedGuides,
        layoutGrid: base.canvasOverlays.layoutGrid,
        baselineGrid: base.canvasOverlays.baselineGrid,
      },
      statusSections: base.statusSections.map((s) => {
        const oldKey = s.id === 'layoutScore' ? 'debt' : s.id;
        const oldVal = (old.statusSections as Record<string, boolean> | undefined)?.[oldKey];
        return { ...s, visible: oldVal ?? s.visible };
      }),
    };
  }

  // Already at target version
  return config as unknown as WorkspaceConfig;
}
