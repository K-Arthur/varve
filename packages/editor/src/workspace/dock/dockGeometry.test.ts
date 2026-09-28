import { beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltinPanels } from '../panelDefinitions';
import { resetPanelRegistry } from '../panelRegistry';
import {
  getDockCanvasRect,
  getDockPanelPlacements,
  projectVisibleDockTree,
  resolveDockTreeGeometry,
} from './dockGeometry';
import type { DockNode } from './dockTypes';

const node: DockNode = {
  kind: 'split',
  id: 'root',
  direction: 'row',
  ratio: 0.25,
  first: { kind: 'panel', id: 'layers-node', panelInstanceId: 'layers-1', panelTypeId: 'layers' },
  second: {
    kind: 'split',
    id: 'main',
    direction: 'column',
    ratio: 0.75,
    first: { kind: 'canvas', id: 'canvas' },
    second: {
      kind: 'tabs',
      id: 'bottom-tabs',
      activePanelInstanceId: 'email-1',
      panels: [
        { instanceId: 'timeline-1', panelTypeId: 'timeline' },
        { instanceId: 'email-1', panelTypeId: 'emailPreview' },
      ],
    },
  },
};

describe('dock geometry', () => {
  beforeEach(() => {
    resetPanelRegistry();
    registerBuiltinPanels();
  });

  it('projects nested splits and tab visibility to normalized panel placements', () => {
    const placements = getDockPanelPlacements(node);
    expect(placements).toEqual([
      {
        panelTypeId: 'layers',
        panelInstanceId: 'layers-1',
        rect: { x: 0, y: 0, width: 0.25, height: 1 },
        active: true,
      },
      {
        panelTypeId: 'timeline',
        panelInstanceId: 'timeline-1',
        rect: { x: 0.25, y: 0.75, width: 0.75, height: 0.25 },
        active: false,
        tabGroupNodeId: 'bottom-tabs',
      },
      {
        panelTypeId: 'emailPreview',
        panelInstanceId: 'email-1',
        rect: { x: 0.25, y: 0.75, width: 0.75, height: 0.25 },
        active: true,
        tabGroupNodeId: 'bottom-tabs',
      },
    ]);
  });

  it('clamps defensive ratios before calculating geometry', () => {
    const placements = getDockPanelPlacements({
      kind: 'split',
      id: 'bad-ratio',
      direction: 'row',
      ratio: Number.NaN,
      first: { kind: 'panel', id: 'p', panelInstanceId: 'layers-1', panelTypeId: 'layers' },
      second: { kind: 'canvas', id: 'canvas' },
    });
    expect(placements[0]?.rect).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
  });

  it('reclaims the hidden panel branch without mutating the saved tree', () => {
    const projected = projectVisibleDockTree(node, { layers: false });
    expect(getDockCanvasRect(projected)).toEqual({ x: 0, y: 0, width: 1, height: 0.75 });
    expect(getDockPanelPlacements(projected).map((placement) => placement.panelTypeId)).toEqual([
      'timeline',
      'emailPreview',
    ]);
    expect(getDockCanvasRect(node)).toEqual({ x: 0.25, y: 0, width: 0.75, height: 0.75 });
  });

  it('keeps registered desktop minimum sizes when the host can satisfy them', () => {
    const { panels, canvas, minimumSize } = resolveDockTreeGeometry(
      {
        kind: 'split',
        id: 'shell',
        direction: 'row',
        ratio: 0.22,
        first: { kind: 'panel', id: 'layers', panelInstanceId: 'l', panelTypeId: 'layers' },
        second: {
          kind: 'split',
          id: 'main',
          direction: 'row',
          ratio: 0.74,
          first: { kind: 'canvas', id: 'canvas' },
          second: {
            kind: 'panel',
            id: 'inspector',
            panelInstanceId: 'i',
            panelTypeId: 'inspector',
          },
        },
      },
      900,
      600,
    );
    expect(minimumSize).toEqual({ width: 740, height: 240 });
    expect(panels.map((placement) => [placement.panelTypeId, placement.rect.width])).toEqual([
      ['layers', 198],
      ['inspector', 240],
    ]);
    expect(canvas?.width).toBe(462);
    expect(canvas?.width).toBeGreaterThanOrEqual(320);
  });

  it('exposes tab-group bounds and the active instance for accessible controls', () => {
    const geometry = resolveDockTreeGeometry(node, 800, 600);
    expect(geometry.splitters.map((splitter) => [splitter.nodeId, splitter.direction])).toEqual([
      ['root', 'row'],
      ['main', 'column'],
    ]);
    expect(geometry.splitters[0]?.rect).toEqual({ x: 188, y: 0, width: 24, height: 600 });
    expect(geometry.splitters[1]?.rect).toEqual({ x: 200, y: 396, width: 600, height: 24 });
    expect(geometry.tabGroups).toEqual([
      {
        nodeId: 'bottom-tabs',
        rect: { x: 200, y: 408, width: 600, height: 192 },
        activePanelInstanceId: 'email-1',
        panels: [
          { instanceId: 'timeline-1', panelTypeId: 'timeline' },
          { instanceId: 'email-1', panelTypeId: 'emailPreview' },
        ],
      },
    ]);
    expect(geometry.panels[1]?.tabGroupNodeId).toBe('bottom-tabs');
    expect(geometry.panels[2]?.tabGroupNodeId).toBe('bottom-tabs');
  });
});
