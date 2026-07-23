/**
 * Overlay Manager
 *
 * Manages canvas overlays for audit findings.
 * Provides visual indicators for findings on the canvas.
 *
 * @module overlayManager
 */

import type { AuditFinding, AuditSeverity } from '@strata/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Overlay type.
 */
export type OverlayType = 'highlight' | 'outline' | 'badge' | 'arrow' | 'region';

/**
 * Overlay position.
 */
export interface OverlayPosition {
  /** X coordinate */
  x: number;

  /** Y coordinate */
  y: number;

  /** Width */
  w: number;

  /** Height */
  h: number;
}

/**
 * Overlay style.
 */
export interface OverlayStyle {
  /** Border color */
  borderColor?: string;

  /** Border width */
  borderWidth?: number;

  /** Background color */
  backgroundColor?: string;

  /** Opacity (0-1) */
  opacity?: number;

  /** Border radius */
  borderRadius?: number;

  /** Dash pattern for dashed lines */
  dashPattern?: number[];
}

/**
 * Canvas overlay.
 */
export interface CanvasOverlay {
  /** Overlay ID */
  id: string;

  /** Associated finding ID */
  findingId: string;

  /** Overlay type */
  type: OverlayType;

  /** Position on canvas */
  position: OverlayPosition;

  /** Overlay style */
  style: OverlayStyle;

  /** Label text (for badges) */
  label?: string;

  /** Whether overlay is visible */
  visible: boolean;

  /** Z-index for layering */
  zIndex: number;
}

/**
 * Overlay manager options.
 */
export interface OverlayManagerOptions {
  /** Default overlay style */
  defaultStyle?: OverlayStyle;

  /** Maximum number of overlays to show */
  maxOverlays?: number;

  /** Whether to group overlays by node */
  groupByNode?: boolean;
}

// ============================================================================
// Overlay Manager
// ============================================================================

/**
 * Canvas overlay manager.
 */
export class OverlayManager {
  private overlays: Map<string, CanvasOverlay> = new Map();
  private findingOverlays: Map<string, string[]> = new Map(); // finding ID -> overlay IDs
  private nodeOverlays: Map<string, string[]> = new Map(); // node ID -> overlay IDs
  private options: OverlayManagerOptions;

  constructor(options: OverlayManagerOptions = {}) {
    this.options = {
      defaultStyle: {
        borderWidth: 2,
        opacity: 0.8,
        borderRadius: 4,
      },
      maxOverlays: 100,
      groupByNode: true,
      ...options,
    };
  }

  /**
   * Add an overlay for a finding.
   *
   * @param finding - The finding to add an overlay for
   * @param position - The position of the overlay
   * @param type - The overlay type
   * @param style - Custom style (optional)
   * @returns Overlay ID
   */
  addOverlay(
    finding: AuditFinding,
    position: OverlayPosition,
    type: OverlayType = 'outline',
    style?: Partial<OverlayStyle>,
  ): string {
    const overlayId = `overlay-${finding.findingId}-${Date.now()}`;

    const overlayStyle: OverlayStyle = {
      ...this.options.defaultStyle,
      ...style,
      borderColor: this.getSeverityColor(finding.severity),
    };

    const overlay: CanvasOverlay = {
      id: overlayId,
      findingId: finding.findingId,
      type,
      position,
      style: overlayStyle,
      visible: true,
      zIndex: this.getZIndex(finding.severity),
    };

    this.overlays.set(overlayId, overlay);

    // Track by finding
    if (!this.findingOverlays.has(finding.findingId)) {
      this.findingOverlays.set(finding.findingId, []);
    }
    this.findingOverlays.get(finding.findingId)!.push(overlayId);

    // Track by node
    for (const nodeId of finding.nodeIds) {
      if (!this.nodeOverlays.has(nodeId)) {
        this.nodeOverlays.set(nodeId, []);
      }
      this.nodeOverlays.get(nodeId)!.push(overlayId);
    }

    // Enforce max overlays
    this.enforceMaxOverlays();

    return overlayId;
  }

  /**
   * Remove an overlay.
   *
   * @param overlayId - The overlay ID
   * @returns Whether removal was successful
   */
  removeOverlay(overlayId: string): boolean {
    const overlay = this.overlays.get(overlayId);
    if (!overlay) {
      return false;
    }

    // Remove from finding map
    const findingOverlays = this.findingOverlays.get(overlay.findingId);
    if (findingOverlays) {
      const index = findingOverlays.indexOf(overlayId);
      if (index > -1) {
        findingOverlays.splice(index, 1);
      }
    }

    // Remove from node maps
    const nodeId = overlay.findingId.split(':')[1];
    if (nodeId) {
      const nodeOverlays = this.nodeOverlays.get(nodeId);
      if (nodeOverlays) {
        const index = nodeOverlays.indexOf(overlayId);
        if (index > -1) {
          nodeOverlays.splice(index, 1);
        }
      }
    }

    return this.overlays.delete(overlayId);
  }

  /**
   * Remove all overlays for a finding.
   *
   * @param findingId - The finding ID
   * @returns Number of overlays removed
   */
  removeOverlaysForFinding(findingId: string): number {
    const overlayIds = this.findingOverlays.get(findingId) || [];
    let removed = 0;

    for (const overlayId of overlayIds) {
      if (this.removeOverlay(overlayId)) {
        removed++;
      }
    }

    this.findingOverlays.delete(findingId);
    return removed;
  }

  /**
   * Remove all overlays for a node.
   *
   * @param nodeId - The node ID
   * @returns Number of overlays removed
   */
  removeOverlaysForNode(nodeId: string): number {
    const overlayIds = this.nodeOverlays.get(nodeId) || [];
    let removed = 0;

    for (const overlayId of overlayIds) {
      if (this.removeOverlay(overlayId)) {
        removed++;
      }
    }

    this.nodeOverlays.delete(nodeId);
    return removed;
  }

  /**
   * Clear all overlays.
   */
  clearAll(): void {
    this.overlays.clear();
    this.findingOverlays.clear();
    this.nodeOverlays.clear();
  }

  /**
   * Get an overlay by ID.
   *
   * @param overlayId - The overlay ID
   * @returns The overlay or null
   */
  getOverlay(overlayId: string): CanvasOverlay | null {
    return this.overlays.get(overlayId) || null;
  }

  /**
   * Get all overlays.
   *
   * @returns All overlays
   */
  getAllOverlays(): CanvasOverlay[] {
    return Array.from(this.overlays.values());
  }

  /**
   * Get overlays for a finding.
   *
   * @param findingId - The finding ID
   * @returns Overlays for the finding
   */
  getOverlaysForFinding(findingId: string): CanvasOverlay[] {
    const overlayIds = this.findingOverlays.get(findingId) || [];
    return overlayIds
      .map((id) => this.overlays.get(id))
      .filter((o): o is CanvasOverlay => o !== undefined);
  }

  /**
   * Get overlays for a node.
   *
   * @param nodeId - The node ID
   * @returns Overlays for the node
   */
  getOverlaysForNode(nodeId: string): CanvasOverlay[] {
    const overlayIds = this.nodeOverlays.get(nodeId) || [];
    return overlayIds
      .map((id) => this.overlays.get(id))
      .filter((o): o is CanvasOverlay => o !== undefined);
  }

  /**
   * Show an overlay.
   *
   * @param overlayId - The overlay ID
   */
  showOverlay(overlayId: string): void {
    const overlay = this.overlays.get(overlayId);
    if (overlay) {
      overlay.visible = true;
    }
  }

  /**
   * Hide an overlay.
   *
   * @param overlayId - The overlay ID
   */
  hideOverlay(overlayId: string): void {
    const overlay = this.overlays.get(overlayId);
    if (overlay) {
      overlay.visible = false;
    }
  }

  /**
   * Toggle overlay visibility.
   *
   * @param overlayId - The overlay ID
   */
  toggleOverlay(overlayId: string): void {
    const overlay = this.overlays.get(overlayId);
    if (overlay) {
      overlay.visible = !overlay.visible;
    }
  }

  /**
   * Update overlay position.
   *
   * @param overlayId - The overlay ID
   * @param position - New position
   */
  updateOverlayPosition(overlayId: string, position: OverlayPosition): void {
    const overlay = this.overlays.get(overlayId);
    if (overlay) {
      overlay.position = position;
    }
  }

  /**
   * Update overlay style.
   *
   * @param overlayId - The overlay ID
   * @param style - New style
   */
  updateOverlayStyle(overlayId: string, style: Partial<OverlayStyle>): void {
    const overlay = this.overlays.get(overlayId);
    if (overlay) {
      overlay.style = { ...overlay.style, ...style };
    }
  }

  /**
   * Get color for severity.
   *
   * @param severity - The severity
   * @returns Color string
   */
  private getSeverityColor(severity: AuditSeverity): string {
    switch (severity) {
      case 'error':
        return '#ef4444'; // Red
      case 'warning':
        return '#f59e0b'; // Orange
      case 'suggestion':
        return '#3b82f6'; // Blue
      case 'advisory':
        return '#6b7280'; // Gray
      default:
        return '#3b82f6';
    }
  }

  /**
   * Get z-index for severity.
   *
   * @param severity - The severity
   * @returns Z-index
   */
  private getZIndex(severity: AuditSeverity): number {
    switch (severity) {
      case 'error':
        return 1000;
      case 'warning':
        return 900;
      case 'suggestion':
        return 800;
      case 'advisory':
        return 700;
      default:
        return 800;
    }
  }

  /**
   * Enforce maximum number of overlays.
   */
  private enforceMaxOverlays(): void {
    if (this.options.maxOverlays === undefined) {
      return;
    }

    while (this.overlays.size > this.options.maxOverlays) {
      // Remove oldest overlay (first in map)
      const firstKey = this.overlays.keys().next().value;
      if (firstKey) {
        this.removeOverlay(firstKey);
      }
    }
  }
}

// ============================================================================
// Overlay Utils
// ============================================================================

/**
 * Create a highlight overlay.
 *
 * @param _finding - The finding
 * @param position - The position
 * @param style - Custom style
 * @returns Overlay configuration
 */
export function createHighlightOverlay(
  _finding: AuditFinding,
  position: OverlayPosition,
  style?: Partial<OverlayStyle>,
): Partial<CanvasOverlay> {
  return {
    type: 'highlight',
    position,
    style: {
      backgroundColor: 'rgba(255, 255, 0, 0.3)',
      ...style,
    },
  };
}

/**
 * Create an outline overlay.
 *
 * @param _finding - The finding
 * @param position - The position
 * @param style - Custom style
 * @returns Overlay configuration
 */
export function createOutlineOverlay(
  _finding: AuditFinding,
  position: OverlayPosition,
  style?: Partial<OverlayStyle>,
): Partial<CanvasOverlay> {
  return {
    type: 'outline',
    position,
    style: {
      borderWidth: 2,
      dashPattern: [5, 5],
      ...style,
    },
  };
}

/**
 * Create a badge overlay.
 *
 * @param _finding - The finding
 * @param position - The position
 * @param label - Badge label
 * @param style - Custom style
 * @returns Overlay configuration
 */
export function createBadgeOverlay(
  _finding: AuditFinding,
  position: OverlayPosition,
  label: string,
  style?: Partial<OverlayStyle>,
): Partial<CanvasOverlay> {
  return {
    type: 'badge',
    position,
    label,
    style: {
      backgroundColor: '#ef4444',
      borderColor: '#ffffff',
      borderWidth: 2,
      borderRadius: 12,
      ...style,
    },
  };
}
