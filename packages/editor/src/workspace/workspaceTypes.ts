/**
 * Workspace mode types — lightweight configuration over the same editor shell.
 *
 * A workspace mode controls which panels are shown, the default tool, toolbar
 * visibility, and canvas overlays. It does NOT create a separate document model
 * or fork editing commands.
 */

export type WorkspaceMode = 'design' | 'print' | 'drawing' | 'image';

export interface WorkspaceConfig {
  /** Panels always rendered (grid cells in Shell). */
  visiblePanels: {
    layers: boolean;
    inspector: boolean;
    timeline: boolean;
    pagenav: boolean;
    library: boolean;
  };
  /** Tool to activate when switching to this mode (empty = preserve current). */
  defaultTool?: 'select' | 'text' | 'paint' | 'frame' | 'hand';
  /** Show the floating toolbar. */
  floatingToolbar: boolean;
  /** Show the status bar. */
  statusBar: boolean;
  /** Show the menubar tab strip (multi-doc tabs). */
  tabStrip: boolean;
  /** Canvas overlay modes active by default. */
  canvasOverlays?: {
    rulers: boolean;
    guides: boolean;
    pixelGrid: boolean;
    dotGrid: boolean;
  };
  /** Status bar info sections to show. */
  statusSections?: {
    toolName: boolean;
    cursorPos: boolean;
    zoom: boolean;
    selectionInfo: boolean;
    unit: boolean;
    preflight: boolean;
    debt: boolean;
  };
}

export const WORKSPACE_CONFIGS: Record<WorkspaceMode, WorkspaceConfig> = {
  design: {
    visiblePanels: {
      layers: true,
      inspector: true,
      timeline: false,
      pagenav: true,
      library: false,
    },
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
    },
    statusSections: {
      toolName: true,
      cursorPos: true,
      zoom: true,
      selectionInfo: true,
      unit: true,
      preflight: false,
      debt: true,
    },
  },
  print: {
    visiblePanels: {
      layers: true,
      inspector: true,
      timeline: false,
      pagenav: true,
      library: false,
    },
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: false,
      dotGrid: true,
    },
    statusSections: {
      toolName: true,
      cursorPos: true,
      zoom: true,
      selectionInfo: true,
      unit: true,
      preflight: true,
      debt: true,
    },
  },
  drawing: {
    visiblePanels: {
      layers: true,
      inspector: true,
      timeline: false,
      pagenav: false,
      library: false,
    },
    defaultTool: 'paint',
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    canvasOverlays: {
      rulers: true,
      guides: false,
      pixelGrid: false,
      dotGrid: true,
    },
    statusSections: {
      toolName: true,
      cursorPos: true,
      zoom: true,
      selectionInfo: true,
      unit: true,
      preflight: false,
      debt: true,
    },
  },
  image: {
    visiblePanels: {
      layers: true,
      inspector: true,
      timeline: false,
      pagenav: false,
      library: false,
    },
    floatingToolbar: true,
    statusBar: true,
    tabStrip: true,
    canvasOverlays: {
      rulers: true,
      guides: true,
      pixelGrid: true,
      dotGrid: false,
    },
    statusSections: {
      toolName: true,
      cursorPos: true,
      zoom: true,
      selectionInfo: true,
      unit: true,
      preflight: false,
      debt: true,
    },
  },
};

export function getWorkspaceConfig(mode: WorkspaceMode): WorkspaceConfig {
  return WORKSPACE_CONFIGS[mode] ?? WORKSPACE_CONFIGS.design;
}

export const WORKSPACE_LABELS: Record<WorkspaceMode, string> = {
  design: 'Design',
  print: 'Print',
  drawing: 'Draw',
  image: 'Photo',
};

/** Lucide icon name per mode, for the workspace switcher (icon + label,
 *  Affinity-persona / Figma-Dev-Mode style rather than text-only tabs). */
export const WORKSPACE_ICONS: Record<WorkspaceMode, import('@strata/ui').IconName> = {
  design: 'PenTool',
  print: 'Printer',
  drawing: 'Paintbrush',
  image: 'Image',
};
