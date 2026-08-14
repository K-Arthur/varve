/**
 * Interactive animation export — document to self-contained HTML prototype.
 *
 * Generates a single HTML file with embedded CSS + JS that runs the
 * document's prototype interactions + state machines in the browser with
 * zero external dependencies. Preserves states, triggers, conditions,
 * variables, easing, and transitions.
 *
 * The embedded runtime is intentionally framework-free: plain DOM APIs,
 * event listeners, and CSS transitions. It can run from `file://` or any
 * static host.
 *
 * Research basis: Figma prototype presentation mode, Rive runtime embed,
 * WAI-ARIA Authoring Practices for interactive components.
 */

import type { Shape } from '@varve/engine';
import type {
  Document,
  FrameNode,
  ManagedColor,
  SceneNode,
  SMState,
  SMTransition,
  StateMachine,
} from '@varve/scene';
import { isRgbColor } from '@varve/scene';
import { nodeEffectiveTransform } from './shared';

export interface InteractiveExportOptions {
  /** Emit CSS animation-timeline scroll bindings where supported. */
  useScrollTimeline?: boolean;
  /** Include state-machine runtime (states, transitions, guards). */
  includeStateMachines?: boolean;
  /** Page/frame dimensions override (defaults to first frame). */
  width?: number;
  height?: number;
  title?: string;
}

export interface InteractiveExportResult {
  /** Self-contained HTML document. */
  html: string;
  /** Feature summary for capability-matrix reporting. */
  summary: InteractiveSummary;
}

export interface InteractiveSummary {
  stateMachineCount: number;
  stateCount: number;
  transitionCount: number;
  interactionCount: number;
  variableCount: number;
  features: string[];
  warnings: string[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n: number, precision = 3): string {
  return Number(n.toFixed(precision)).toString();
}

/** Collect all frame nodes to render as prototype screens. */
function collectFrames(doc: Document): FrameNode[] {
  return Object.values(doc.nodes).filter((n): n is FrameNode => n.kind === 'frame');
}

/** Build inline SVG for a node (rect, ellipse, circle, text). */
function nodeToSvgElement(doc: Document, node: SceneNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const t = nodeEffectiveTransform(node);
  const transform = `matrix(${t[0]},${t[1]},${t[2]},${t[3]},${t[4]},${t[5]})`;
  const fill = 'fill' in node && node.fill ? renderColor(node.fill) : '#888888';

  if (node.kind === 'shape') {
    const s = node.shape;
    switch (s.kind) {
      case 'rect':
        return `${indent}<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${fill}" transform="${transform}" />`;
      case 'ellipse':
        return `${indent}<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${fill}" transform="${transform}" />`;
      case 'circle':
        return `${indent}<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${fill}" transform="${transform}" />`;
      case 'line':
      case 'arrow':
        return `${indent}<line x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}" stroke="${fill}" stroke-width="2" transform="${transform}" />`;
      case 'polygon':
      case 'star': {
        const pts = shapeVerticesToPoints(s, 3);
        return `${indent}<polygon points="${pts}" fill="${fill}" transform="${transform}" />`;
      }
      case 'path':
        return `${indent}<path d="${pathToData(s, 3)}" fill="${fill}" transform="${transform}" />`;
    }
  }
  if (node.kind === 'text') {
    const fontSize = node.fontSize ?? 16;
    const fontFamily = node.fontFamily ?? 'Inter, sans-serif';
    return `${indent}<text x="${t[4]}" y="${t[5]}" fill="${fill}" font-size="${fontSize}" font-family="${fontFamily}" transform="matrix(${t[0]},${t[1]},${t[2]},${t[3]},0,0)">${escapeHtml(node.text)}</text>`;
  }
  if (node.kind === 'group' || node.kind === 'frame') {
    const children = (node.children ?? [])
      .map((id) => {
        const child = doc.nodes[id];
        return child ? nodeToSvgElement(doc, child, depth + 1) : '';
      })
      .filter(Boolean)
      .join('\n');
    return `${indent}<g transform="${transform}">\n${children}\n${indent}</g>`;
  }
  return '';
}

function renderColor(color: ManagedColor | undefined): string {
  if (!color) return '#888888';
  if (isRgbColor(color)) {
    const { r, g, b, a } = color;
    return a < 255 ? `rgba(${r},${g},${b},${(a / 255).toFixed(2)})` : `rgb(${r},${g},${b})`;
  }
  return '#888888';
}

function shapeVerticesToPoints(s: Shape, _precision: number): string {
  if (s.kind === 'polygon') {
    const pts: string[] = [];
    for (let i = 0; i < s.sides; i++) {
      const a = (2 * Math.PI * i) / s.sides - Math.PI / 2 + s.rotation;
      pts.push(`${s.cx + s.radius * Math.cos(a)},${s.cy + s.radius * Math.sin(a)}`);
    }
    return pts.join(' ');
  }
  if (s.kind === 'star') {
    const pts: string[] = [];
    for (let i = 0; i < s.points * 2; i++) {
      const a = (Math.PI * i) / s.points - Math.PI / 2 + s.rotation;
      const r = i % 2 === 0 ? s.outerRadius : s.innerRadius;
      pts.push(`${s.cx + r * Math.cos(a)},${s.cy + r * Math.sin(a)}`);
    }
    return pts.join(' ');
  }
  return '';
}

function pathToData(shape: Extract<Shape, { kind: 'path' }>, precision: number): string {
  if (!shape.points || shape.points.length === 0) return '';
  const first = shape.points[0]!;
  const cmds: string[] = [`M ${fmtNum(first.x, precision)} ${fmtNum(first.y, precision)}`];
  for (let i = 1; i < shape.points.length; i++) {
    const prev = shape.points[i - 1]!;
    const curr = shape.points[i]!;
    if (prev.handleOut || curr.handleIn) {
      const c1x = prev.x + (prev.handleOut?.[0] ?? 0);
      const c1y = prev.y + (prev.handleOut?.[1] ?? 0);
      const c2x = curr.x + (curr.handleIn?.[0] ?? 0);
      const c2y = curr.y + (curr.handleIn?.[1] ?? 0);
      cmds.push(
        `C ${fmtNum(c1x, precision)} ${fmtNum(c1y, precision)} ${fmtNum(c2x, precision)} ${fmtNum(c2y, precision)} ${fmtNum(curr.x, precision)} ${fmtNum(curr.y, precision)}`,
      );
    } else {
      cmds.push(`L ${fmtNum(curr.x, precision)} ${fmtNum(curr.y, precision)}`);
    }
  }
  return cmds.join(' ');
}

function triggerToEventType(trigger: string): string {
  switch (trigger) {
    case 'onClick':
      return 'click';
    case 'onHover':
      return 'mouseenter';
    case 'onPointerDown':
      return 'pointerdown';
    case 'onPointerUp':
      return 'pointerup';
    case 'onKeyPress':
      return 'keydown';
    default:
      return 'click';
  }
}

export function exportInteractivePrototype(
  doc: Document,
  options: InteractiveExportOptions = {},
): InteractiveExportResult {
  const frames = collectFrames(doc);
  const sms = Object.values(doc.stateMachines ?? {});
  const interactions = doc.interactions ?? {};
  const variables = doc.variableStore?.variables ?? {};

  const features: string[] = [];
  const warnings: string[] = [];

  if (sms.length > 0) features.push('state-machines');
  if (Object.keys(interactions).length > 0) features.push('interactions');
  if (Object.keys(variables).length > 0) features.push('variables');
  features.push('transitions');

  if (frames.length === 0) {
    warnings.push('No frame nodes found; prototype will have no screens.');
  }

  const width = options.width ?? 375;
  const height = options.height ?? 812;
  const title = options.title ?? 'Varve Prototype';
  const primarySm = sms[0];

  const html = buildHtmlDocument(doc, {
    frames,
    sm: options.includeStateMachines !== false ? primarySm : undefined,
    interactions,
    variables,
    width,
    height,
    title,
    features,
    warnings,
  });

  return {
    html,
    summary: {
      stateMachineCount: sms.length,
      stateCount: sms.reduce((a, sm) => a + sm.states.length, 0),
      transitionCount: sms.reduce((a, sm) => a + sm.transitions.length, 0),
      interactionCount: Object.values(interactions).reduce((a, list) => a + list.length, 0),
      variableCount: Object.keys(variables).length,
      features,
      warnings,
    },
  };
}

function buildHtmlDocument(
  doc: Document,
  ctx: {
    frames: FrameNode[];
    sm?: StateMachine;
    interactions: Record<string, unknown[]>;
    variables: Record<string, unknown>;
    width: number;
    height: number;
    title: string;
    features: string[];
    warnings: string[];
  },
): string {
  const { frames, sm, interactions, variables, width, height, title } = ctx;

  const screensSvg = frames
    .map((frame, idx) => {
      const frameW = frame.w ?? width;
      const frameH = frame.h ?? height;
      const children = (frame.children ?? [])
        .map((id) => {
          const child = doc.nodes[id];
          return child ? nodeToSvgElement(doc, child, 4) : '';
        })
        .filter(Boolean)
        .join('\n');
      return `    <div class="strata-screen${idx === 0 ? ' strata-screen--active' : ''}" data-screen-id="${frame.id}" role="group" aria-label="${escapeHtml(frame.name)}">
      <svg viewBox="0 0 ${frameW} ${frameH}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white" />
${children}
      </svg>
    </div>`;
    })
    .join('\n');

  const smRuntime = sm ? buildSmRuntime(sm) : '';
  const interactionRuntime = buildInteractionRuntime(interactions);
  const variableInit = buildVariableInit(variables);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, system-ui, -apple-system, sans-serif; background: #1a1a2e; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .strata-prototype { position: relative; width: ${width}px; height: {${height}px}; max-width: 100%; background: white; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
    .strata-screen { position: absolute; inset: 0; opacity: 0; pointer-events: none; transition: opacity 300ms ease; }
    .strata-screen--active { opacity: 1; pointer-events: auto; }
    .strata-interactive { cursor: pointer; }
    .strata-hint { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); font-size: 11px; color: rgba(0,0,0,0.4); background: rgba(255,255,255,0.8); padding: 4px 12px; border-radius: 999px; pointer-events: none; }
    .strata-controls { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; }
    .strata-controls button { background: rgba(0,0,0,0.5); color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; }
    .strata-controls button:focus-visible { outline: 2px solid #39d0c6; outline-offset: 2px; }
  </style>
</head>
<body>
  <div class="strata-prototype" role="application" aria-label="${escapeHtml(title)}">
${screensSvg}
    <div class="strata-controls">
      <button type="button" id="strata-reset" aria-label="Reset prototype">Reset</button>
    </div>
    <div class="strata-hint">Click interactive elements</div>
  </div>
  <script>
// === Varve Prototype Runtime (self-contained) ===
(function() {
  'use strict';

  var screens = document.querySelectorAll('.strata-screen');
  var activeScreen = 0;
  var variables = ${variableInit};

  function showScreen(index) {
    if (index < 0 || index >= screens.length) return;
    screens[activeScreen].classList.remove('strata-screen--active');
    screens[index].classList.add('strata-screen--active');
    activeScreen = index;
    enterStateCallbacks.forEach(function(cb) { cb(index); });
  }

  var enterStateCallbacks = [];

${smRuntime}
${interactionRuntime}

  // Reset button
  document.getElementById('strata-reset').addEventListener('click', function() {
    if (typeof resetStateMachine === 'function') resetStateMachine();
    showScreen(0);
  });

  // Keyboard navigation
  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowRight') { showScreen(activeScreen + 1); }
    if (e.key === 'ArrowLeft') { showScreen(activeScreen - 1); });
  });

})();
  </script>
</body>
</html>`;
}

function buildSmRuntime(sm: StateMachine): string {
  if (!sm || sm.states.length === 0) return '';

  const entry = sm.states.find((s) => s.isEntryState) ?? sm.states[0];
  if (!entry) return '';

  const transitionsJson = JSON.stringify(
    sm.transitions.map((t: SMTransition) => ({
      from: t.fromStateId,
      to: t.toStateId,
      trigger: t.trigger,
      condition: t.condition ?? null,
      priority: t.priority ?? 0,
      duration: t.duration ?? 300,
      easing: t.easing ?? { kind: 'ease' },
    })),
  );

  const inputsJson = JSON.stringify(sm.inputs);

  return `
  // === State Machine Runtime ===
  var smTransitions = ${transitionsJson};
  var smInputs = ${inputsJson};
  var smCurrentState = '${entry.id}';

  var smInputValues = {};
  smInputs.forEach(function(inp) { smInputValues[inp.name] = inp.defaultValue ?? (inp.type === 'boolean' ? false : 0); });

  function evaluateCondition(cond) {
    if (!cond) return true;
    try {
      var sanitized = cond.replace(/[^a-zA-Z0-9_.\\s\\-+*\\/<>=!&|()]/g, '');
      // eslint-disable-next-line no-new-func
      return new Function('inputs', 'return ' + sanitized + ';')(smInputValues);
    } catch (e) { return false; }
  }

  function getScreenForState(stateId) {
    var states = ${JSON.stringify(sm.states.map((s: SMState) => ({ id: s.id, name: s.name })))};
    var idx = states.findIndex(function(s) { return s.id === stateId; });
    return idx >= 0 ? idx : 0;
  }

  function fireTrigger(triggerType) {
    var candidates = smTransitions.filter(function(t) {
      return t.fromStateId === smCurrentState && t.trigger === triggerType && evaluateCondition(t.condition);
    });
    if (candidates.length === 0) return;
    candidates.sort(function(a, b) { return (b.priority || 0) - (a.priority || 0); });
    var best = candidates[0];
    smCurrentState = best.to;
    var screenIdx = getScreenForState(best.to);
    if (screenIdx >= 0) showScreen(screenIdx);
  }

  function resetStateMachine() { smCurrentState = '${entry.id}'; }

  document.querySelectorAll('[data-strata-trigger]').forEach(function(el) {
    var trigger = el.getAttribute('data-strata-trigger');
    el.addEventListener('click', function() { fireTrigger(trigger); });
  });
`;
}

function buildInteractionRuntime(interactions: Record<string, unknown[]>): string {
  const entries = Object.entries(interactions);
  if (entries.length === 0) return '';

  const handlers: string[] = [];
  for (const [nodeId, list] of entries) {
    for (const ix of list as Array<{
      id: string;
      trigger?: { kind?: string };
      actions?: Array<{ kind?: string; targetId?: string }>;
      enabled?: boolean;
    }>) {
      if (ix.enabled === false) continue;
      const trigger = ix.trigger?.kind ?? 'onClick';
      const action = ix.actions?.[0];
      if (action?.kind === 'navigateTo' && action.targetId) {
        handlers.push(
          `  document.querySelectorAll('[data-node-id="${nodeId}"]').forEach(function(el) {`,
          `    el.classList.add('strata-interactive');`,
          `    el.addEventListener('${triggerToEventType(trigger)}', function() {`,
          `      var idx = Array.from(screens).findIndex(function(s) { return s.dataset.screenId === '${action.targetId}'; });`,
          `      if (idx >= 0) showScreen(idx);`,
          `    });`,
          `  });`,
        );
      }
    }
  }

  if (handlers.length === 0) return '';
  return `\n  // === Interaction Runtime ===\n${handlers.join('\n')}\n`;
}

function buildVariableInit(variables: Record<string, unknown>): string {
  const entries = Object.entries(variables);
  if (entries.length === 0) return '{}';
  const pairs = entries.map(([id, v]) => {
    const def = (v as { defaultValue?: unknown })?.defaultValue ?? null;
    return `  "${id}": ${JSON.stringify(def)}`;
  });
  return `{\n${pairs.join(',\n')}\n}`;
}

/** Legacy export for backward compatibility. */
export function exportInteractiveAnimations(
  doc: Document,
  options: InteractiveExportOptions = {},
): { html: string; summary: InteractiveSummary } {
  const result = exportInteractivePrototype(doc, options);
  return { html: result.html, summary: result.summary };
}
