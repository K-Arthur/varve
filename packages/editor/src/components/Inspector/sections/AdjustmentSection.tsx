/**
 * AdjustmentSection — adjustment layer controls for the Inspector.
 *
 * Shows only when the selected node is an AdjustmentNode. Renders the
 * appropriate control based on adjustmentType:
 *
 *   Curves        → CurveEditor
 *   Levels        → HistogramWidget
 *   SelectiveColor → SelectiveColorGrid
 *   HSL / Exposure → placeholder (future)
 *
 * Research basis: Photoshop / Lightroom adjustment panels.
 */

import type { CurvePoint, LevelParams, SelectiveColorParams } from '@strata/engine';
import type {
  AdjustmentCurves,
  AdjustmentLevels,
  AdjustmentNode,
  AdjustmentParams,
  AdjustmentSelectiveColor,
  AdjustmentType,
  SceneNode,
} from '@strata/scene';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { CurveEditor } from '../controls/CurveEditor';
import { DisclosureSection } from '../controls/DisclosureSection';
import { HistogramWidget } from '../controls/HistogramWidget';
import { SelectiveColorGrid } from '../controls/SelectiveColorGrid';

export interface AdjustmentSectionProps {
  nodes: SceneNode[];
}

function isAdjustmentNode(n: SceneNode): n is AdjustmentNode {
  return n.kind === 'adjustment';
}

const TYPE_OPTIONS: { value: AdjustmentType; label: string }[] = [
  { value: 'curves', label: 'Curves' },
  { value: 'levels', label: 'Levels' },
  { value: 'selectiveColor', label: 'Selective Color' },
  { value: 'hsl', label: 'HSL' },
  { value: 'exposure', label: 'Exposure' },
];

function defaultCurvesParams(): AdjustmentCurves {
  return {
    channel: 'rgb',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  };
}

function defaultLevelsParams(): AdjustmentLevels {
  return {
    channel: 'rgb',
    inputBlack: 0,
    inputWhite: 255,
    gamma: 1,
    outputBlack: 0,
    outputWhite: 255,
  };
}

function defaultSelectiveColorParams(): AdjustmentSelectiveColor[] {
  const targets: AdjustmentSelectiveColor['color'][] = [
    'red',
    'green',
    'blue',
    'cyan',
    'magenta',
    'yellow',
    'white',
    'neutral',
    'black',
  ];
  return targets.map((color) => ({
    color,
    cyan: 0,
    magenta: 0,
    yellow: 0,
    black: 0,
    method: 'relative' as const,
  }));
}

export function AdjustmentSection({ nodes }: AdjustmentSectionProps) {
  const { updateNode, announce } = useEditor();
  const adjNode =
    nodes.length === 1 && isAdjustmentNode(nodes[0] as SceneNode)
      ? (nodes[0] as AdjustmentNode)
      : null;

  if (!adjNode) return null;

  const setType = useCallback(
    (type: AdjustmentType) => {
      let params: AdjustmentParams;
      switch (type) {
        case 'curves':
          params = defaultCurvesParams();
          break;
        case 'levels':
          params = defaultLevelsParams();
          break;
        case 'selectiveColor':
          params = defaultSelectiveColorParams() as unknown as AdjustmentSelectiveColor;
          break;
        default:
          params = defaultCurvesParams();
      }
      updateNode(adjNode.id, (n) => ({
        ...n,
        adjustmentType: type,
        params,
      }));
      announce(`Adjustment type changed to ${type}`);
    },
    [adjNode.id, updateNode, announce],
  );

  const setClipping = useCallback(
    (clipping: boolean) => {
      updateNode(adjNode.id, (n) => ({ ...n, clipping }));
      announce(clipping ? 'Clipping enabled' : 'Clipping disabled');
    },
    [adjNode.id, updateNode, announce],
  );

  const setCurvesPoints = useCallback(
    (points: CurvePoint[]) => {
      const params = adjNode.params as AdjustmentCurves;
      updateNode(adjNode.id, (n) => ({
        ...n,
        params: { ...params, points } as AdjustmentCurves as AdjustmentParams,
      }));
    },
    [adjNode.id, adjNode.params, updateNode],
  );

  const setLevels = useCallback(
    (levels: LevelParams) => {
      updateNode(adjNode.id, (n) => ({
        ...n,
        params: {
          channel: 'rgb' as const,
          inputBlack: levels.inputBlack,
          inputWhite: levels.inputWhite,
          gamma: levels.gamma,
          outputBlack: levels.outputBlack,
          outputWhite: levels.outputWhite,
        } as AdjustmentLevels as AdjustmentParams,
      }));
    },
    [adjNode.id, updateNode],
  );

  const setSelectiveColor = useCallback(
    (params: SelectiveColorParams[]) => {
      const mapped = params.map((p) => ({
        color: p.color as AdjustmentSelectiveColor['color'],
        cyan: p.cyan,
        magenta: p.magenta,
        yellow: p.yellow,
        black: p.black,
        method: p.method as AdjustmentSelectiveColor['method'],
      }));
      updateNode(adjNode.id, (n) => ({
        ...n,
        params: mapped as unknown as AdjustmentParams,
      }));
    },
    [adjNode.id, updateNode],
  );

  const renderControl = () => {
    switch (adjNode.adjustmentType) {
      case 'curves': {
        const params = adjNode.params as AdjustmentCurves;
        const curvePoints: CurvePoint[] = params.points.map((p) => ({ x: p.x, y: p.y }));
        return <CurveEditor value={curvePoints} onChange={setCurvesPoints} />;
      }
      case 'levels': {
        const params = adjNode.params as AdjustmentLevels;
        const levelParams: LevelParams = {
          inputBlack: params.inputBlack,
          inputWhite: params.inputWhite,
          gamma: params.gamma,
          outputBlack: params.outputBlack,
          outputWhite: params.outputWhite,
        };
        return <HistogramWidget levels={levelParams} onChange={setLevels} />;
      }
      case 'selectiveColor': {
        const params = adjNode.params as unknown as AdjustmentSelectiveColor[];
        const scParams: SelectiveColorParams[] = params.map((p) => ({
          color: p.color as SelectiveColorParams['color'],
          cyan: p.cyan,
          magenta: p.magenta,
          yellow: p.yellow,
          black: p.black,
          method: p.method as SelectiveColorParams['method'],
        }));
        return <SelectiveColorGrid value={scParams} onChange={setSelectiveColor} />;
      }
      case 'hsl':
      case 'exposure':
        return (
          <div className="insp-empty-message">
            {adjNode.adjustmentType === 'hsl' ? 'HSL' : 'Exposure'} adjustment coming soon
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <DisclosureSection title="Adjustment" defaultExpanded={true}>
      <div className="insp-field">
        <label className="insp-field__label">Type</label>
        <div className="insp-field__control">
          <select
            aria-label="Adjustment type"
            className="insp-select"
            value={adjNode.adjustmentType}
            onChange={(e) => setType(e.target.value as AdjustmentType)}
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {renderControl()}
      <div className="insp-field">
        <label className="insp-field__label" style={{ width: 'auto' }}>
          <input
            type="checkbox"
            checked={adjNode.clipping}
            onChange={(e) => setClipping(e.target.checked)}
            style={{ marginRight: 'var(--space-1)' }}
          />
          Clip to layer below
        </label>
      </div>
    </DisclosureSection>
  );
}
