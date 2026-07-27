import type { Point, Rect } from '@strata/shared';
import type {
  AuditSeverity,
  OverlayContext,
  OverlayPrimitive,
  OverlayProvider,
  OverlayToggleState,
} from './types';

const CELL_SIZE = 128;

function rectCells(r: Rect): string[] {
  const minX = Math.floor(r.x / CELL_SIZE);
  const minY = Math.floor(r.y / CELL_SIZE);
  const maxX = Math.floor((r.x + r.w) / CELL_SIZE);
  const maxY = Math.floor((r.y + r.h) / CELL_SIZE);
  const keys: string[] = [];
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      keys.push(`${cx},${cy}`);
    }
  }
  return keys;
}

interface SpatialEntry {
  primitive: OverlayPrimitive;
  worldBounds: Rect;
}

export interface LODCluster {
  center: { x: number; y: number };
  count: number;
  severities: Map<AuditSeverity, number>;
  findingIds: string[];
}

/**
 * Registry for audit overlay providers.
 * Manages provider registration, spatial indexing, culling, and LOD.
 */
export class OverlayRegistry {
  private providers = new Map<string, OverlayProvider>();
  private spatialIndex = new Map<string, SpatialEntry[]>();
  private toggleState: OverlayToggleState;

  constructor(toggleState?: OverlayToggleState) {
    this.toggleState = toggleState ?? {
      masterEnabled: false,
      providerOverrides: {},
      severityFilter: [],
    };
  }

  register(provider: OverlayProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  getProvider(id: string): OverlayProvider | undefined {
    return this.providers.get(id);
  }

  getAllProviders(): OverlayProvider[] {
    return Array.from(this.providers.values());
  }

  setToggleState(state: OverlayToggleState): void {
    this.toggleState = state;
  }

  getToggleState(): OverlayToggleState {
    return this.toggleState;
  }

  isProviderEnabled(providerId: string): boolean {
    if (!this.toggleState.masterEnabled) return false;
    const override = this.toggleState.providerOverrides[providerId];
    if (override !== undefined) return override;
    const provider = this.providers.get(providerId);
    return provider?.enabled ?? true;
  }

  private severityPasses(severity: AuditSeverity): boolean {
    if (this.toggleState.severityFilter.length === 0) return true;
    return this.toggleState.severityFilter.includes(severity);
  }

  scan(
    ctx: OverlayContext,
    viewportRect: Rect,
    maxPrimitives: number,
    clusterThresholdPx: number,
    zoom: number,
  ): {
    primitives: OverlayPrimitive[];
    clusters: LODCluster[];
    totalAvailable: number;
    displayed: number;
  } {
    this.spatialIndex.clear();

    const allPrimitives: { primitive: OverlayPrimitive; bounds: Rect; severity: AuditSeverity }[] =
      [];
    const providers = Array.from(this.providers.values());

    for (const provider of providers) {
      if (!this.isProviderEnabled(provider.id)) continue;

      const primitives = provider.getPrimitives(ctx);
      for (const p of primitives) {
        if (!this.severityPasses(p.kind === 'badge' ? p.severity : 'warning')) continue;

        const bounds = this.primitiveBounds(p);
        if (!bounds) continue;

        allPrimitives.push({
          primitive: p,
          bounds,
          severity: p.kind === 'badge' ? p.severity : 'warning',
        });

        for (const key of rectCells(bounds)) {
          const existing = this.spatialIndex.get(key) ?? [];
          existing.push({ primitive: p, worldBounds: bounds });
          this.spatialIndex.set(key, existing);
        }
      }
    }

    const visible = this.cullSpatial(allPrimitives, viewportRect);
    const { result, clusters, displayed } = this.applyLODAndCap(
      visible,
      viewportRect,
      maxPrimitives,
      clusterThresholdPx,
      zoom,
    );

    result.sort((a, b) => {
      const za = this.zOrder(a.findingId);
      const zb = this.zOrder(b.findingId);
      return za - zb;
    });

    return {
      primitives: result,
      clusters,
      totalAvailable: allPrimitives.length,
      displayed,
    };
  }

  private primitiveBounds(p: OverlayPrimitive): Rect | null {
    switch (p.kind) {
      case 'rect':
        return p.bounds;
      case 'path': {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const pt of p.data) {
          if (pt[0] < minX) minX = pt[0];
          if (pt[1] < minY) minY = pt[1];
          if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] > maxY) maxY = pt[1];
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }
      case 'point':
        return { x: p.at[0], y: p.at[1], w: 0, h: 0 };
      case 'badge':
        return { x: p.anchor[0], y: p.anchor[1], w: 0, h: 0 };
    }
  }

  private cullSpatial(
    items: { primitive: OverlayPrimitive; bounds: Rect; severity: AuditSeverity }[],
    viewportRect: Rect,
  ): { primitive: OverlayPrimitive; bounds: Rect; severity: AuditSeverity }[] {
    if (items.length === 0) return [];

    const cellKeys = rectCells(viewportRect);
    const seen = new Set<string>();

    for (const key of cellKeys) {
      const cellEntries = this.spatialIndex.get(key);
      if (!cellEntries) continue;
      for (const entry of cellEntries) {
        if (seen.has(entry.primitive.findingId)) continue;
        const b = entry.worldBounds;
        const bounds = b;
        if (bounds.w === 0 && bounds.h === 0) {
          if (
            bounds.x >= viewportRect.x &&
            bounds.x <= viewportRect.x + viewportRect.w &&
            bounds.y >= viewportRect.y &&
            bounds.y <= viewportRect.y + viewportRect.h
          ) {
            seen.add(entry.primitive.findingId);
          }
        } else if (
          bounds.x + bounds.w >= viewportRect.x &&
          bounds.x <= viewportRect.x + viewportRect.w &&
          bounds.y + bounds.h >= viewportRect.y &&
          bounds.y <= viewportRect.y + viewportRect.h
        ) {
          seen.add(entry.primitive.findingId);
        }
      }
    }

    return items.filter(({ primitive }) => seen.has(primitive.findingId));
  }

  /** Legacy linear cull fallback. */
  private cullToViewport(
    items: { primitive: OverlayPrimitive; bounds: Rect; severity: AuditSeverity }[],
    viewportRect: Rect,
  ): { primitive: OverlayPrimitive; bounds: Rect; severity: AuditSeverity }[] {
    return items.filter(({ bounds }) => {
      if (bounds.w === 0 && bounds.h === 0) {
        return (
          bounds.x >= viewportRect.x &&
          bounds.x <= viewportRect.x + viewportRect.w &&
          bounds.y >= viewportRect.y &&
          bounds.y <= viewportRect.y + viewportRect.h
        );
      }
      return (
        bounds.x + bounds.w >= viewportRect.x &&
        bounds.x <= viewportRect.x + viewportRect.w &&
        bounds.y + bounds.h >= viewportRect.y &&
        bounds.y <= viewportRect.y + viewportRect.h
      );
    });
  }

  private applyLODAndCap(
    items: { primitive: OverlayPrimitive; bounds: Rect; severity: AuditSeverity }[],
    _viewportRect: Rect,
    maxPrimitives: number,
    clusterThresholdPx: number,
    zoom: number,
  ): { result: OverlayPrimitive[]; clusters: LODCluster[]; displayed: number } {
    const badges = items.filter((i) => i.primitive.kind === 'badge');
    const nonBadges = items.filter((i) => i.primitive.kind !== 'badge');

    const clusteredBadges = this.clusterBadges(badges, clusterThresholdPx, zoom);
    const badgePrimitives = clusteredBadges.visible.map((b) => b.primitive);

    const allResult = [...nonBadges.map((i) => i.primitive), ...badgePrimitives];

    if (allResult.length <= maxPrimitives) {
      return { result: allResult, clusters: clusteredBadges.clusters, displayed: allResult.length };
    }

    const sorted = allResult.sort((a, b) => {
      const za = this.zOrder(a.findingId);
      const zb = this.zOrder(b.findingId);
      return za - zb;
    });

    return {
      result: sorted.slice(0, maxPrimitives),
      clusters: clusteredBadges.clusters,
      displayed: maxPrimitives,
    };
  }

  private clusterBadges(
    badges: { primitive: OverlayPrimitive; bounds: Rect; severity: AuditSeverity }[],
    clusterThresholdPx: number,
    zoom: number,
  ): {
    visible: { primitive: OverlayPrimitive; bounds: Rect; severity: AuditSeverity }[];
    clusters: LODCluster[];
  } {
    if (badges.length === 0 || zoom * clusterThresholdPx <= 0) {
      return { visible: badges, clusters: [] };
    }

    const thresholdWorld = clusterThresholdPx / zoom;
    const clusters: LODCluster[] = [];
    const assigned = new Set<string>();
    const visible: { primitive: OverlayPrimitive; bounds: Rect; severity: AuditSeverity }[] = [];

    for (let i = 0; i < badges.length; i++) {
      const entry = badges[i];
      if (!entry) continue;
      if (assigned.has(entry.primitive.findingId)) continue;

      const pi = entry.primitive;
      const anchor: Point = pi.kind === 'badge' ? pi.anchor : [0, 0];
      const cluster: LODCluster = {
        center: { x: anchor[0], y: anchor[1] },
        count: 0,
        severities: new Map(),
        findingIds: [],
      };

      for (let j = i; j < badges.length; j++) {
        const innerEntry = badges[j];
        if (!innerEntry) continue;
        if (assigned.has(innerEntry.primitive.findingId)) continue;
        const bj = innerEntry.primitive;
        if (bj.kind !== 'badge') continue;
        const dist = Math.hypot(bj.anchor[0] - anchor[0], bj.anchor[1] - anchor[1]);
        if (dist <= thresholdWorld) {
          assigned.add(bj.findingId);
          cluster.count++;
          const sev = bj.severity;
          cluster.severities.set(sev, (cluster.severities.get(sev) ?? 0) + 1);
          cluster.findingIds.push(bj.findingId);
        }
      }

      if (cluster.count === 1) {
        visible.push(entry!);
      } else {
        clusters.push(cluster);
      }
    }

    return { visible, clusters };
  }

  private zOrder(_findingId: string): number {
    for (const provider of this.providers.values()) {
      if (provider.interactive) return 0;
    }
    return 10;
  }
}
