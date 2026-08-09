/**
 * HandTool — canvas panning.
 *
 * Drag pans the viewport. Grab/grabbing cursor.
 * Never creates shapes. Never changes selection.
 *
 * Research basis: Figma Hand tool (H), Illustrator hand tool (H),
 *                 Figma Space-bar spring-loaded pan.
 */

import {
  cancelEditorFrame,
  createEditorFrameKey,
  requestEditorFrame,
} from '../performance/editorFrameRuntime';
import { BaseTool } from './BaseTool';
import {
  decayRateFromFrameRetention,
  navigationFrameDeltaMs,
  prefersReducedNavigationMotion,
  stepDecayedMotion,
} from './navigationPhysics';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

const HAND_DECAY_RATE = decayRateFromFrameRetention(0.95);
const HAND_STOP_SPEED = 0.5 * 60;

export class HandTool extends BaseTool {
  id = 'hand' as const;
  private startPan: { x: number; y: number } = { x: 0, y: 0 };
  /** Tracks current pan independently of ctx.pan, which can be a stale
   *  closure capture (production ctx.pan is immutable — setPan replaces
   *  the state object, it does not mutate ctx.pan in place). */
  private currentPan: { x: number; y: number } = { x: 0, y: 0 };
  private velocity: { x: number; y: number } | null = null;
  private readonly frameKey = createEditorFrameKey('hand-inertia');
  private positionHistory: Array<{ x: number; y: number; time: number }> = [];

  override cursor(state: ToolCursorState): CursorSpec {
    return state === 'drag' ? { css: 'grabbing' } : { css: 'grab' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (e.button !== 0 && e.button !== 1) return { consumed: false };
    this.stopMomentum();
    ctx.setPointerCapture(e.pointerId);
    const canvas = { x: e.clientX, y: e.clientY };
    this.drag = {
      kind: 'dragging',
      pointerId: e.pointerId,
      startCanvas: canvas,
      startWorld: { x: 0, y: 0 },
      currentCanvas: canvas,
      currentWorld: { x: 0, y: 0 },
    };
    this.startPan = { ...ctx.pan };
    this.currentPan = { ...ctx.pan };
    this.positionHistory = [{ x: e.clientX, y: e.clientY, time: performance.now() }];
    return { consumed: true, captured: true };
  }

  override onDragMove(ctx: ToolContext): void {
    const dx = this.drag.currentCanvas.x - this.drag.startCanvas.x;
    const dy = this.drag.currentCanvas.y - this.drag.startCanvas.y;
    this.currentPan = { x: this.startPan.x + dx, y: this.startPan.y + dy };
    ctx.setPan(this.currentPan);
    this.positionHistory.push({
      x: this.drag.currentCanvas.x,
      y: this.drag.currentCanvas.y,
      time: performance.now(),
    });
    if (this.positionHistory.length > 3) {
      this.positionHistory.shift();
    }
  }

  override onDragEnd(ctx: ToolContext): void {
    const len = this.positionHistory.length;
    if (len >= 2) {
      const first = this.positionHistory[0]!;
      const last = this.positionHistory[len - 1]!;
      const dt = last.time - first.time;
      if (dt > 0) {
        this.velocity = {
          x: ((last.x - first.x) / dt) * 1000,
          y: ((last.y - first.y) / dt) * 1000,
        };
      }
    }
    this.positionHistory = [];
    this.startMomentum(ctx);
  }

  override onDragCancel(_ctx: ToolContext): void {
    this.stopMomentum();
    this.positionHistory = [];
  }

  private startMomentum(ctx: ToolContext): void {
    if (!this.velocity || prefersReducedNavigationMotion()) {
      this.velocity = null;
      return;
    }
    let previousFrameTime: number | null = null;
    const tick = (frameTimeMs: number) => {
      if (!this.velocity) return;
      const elapsedMs = navigationFrameDeltaMs(previousFrameTime, frameTimeMs);
      previousFrameTime = frameTimeMs;
      const step = stepDecayedMotion(this.velocity, elapsedMs, HAND_DECAY_RATE, HAND_STOP_SPEED);
      if (step.stopped) {
        this.velocity = null;
        return;
      }
      this.velocity = step.velocity;
      this.currentPan = {
        x: this.currentPan.x + step.delta.x,
        y: this.currentPan.y + step.delta.y,
      };
      ctx.setPan(this.currentPan);
      requestEditorFrame(this.frameKey, 'input', tick);
    };
    requestEditorFrame(this.frameKey, 'input', tick);
  }

  private stopMomentum(): void {
    cancelEditorFrame(this.frameKey);
    this.velocity = null;
  }
}
