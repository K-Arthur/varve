/**
 * ToolManager — central event dispatcher for all editing tools.
 *
 * Owns the active tool, routes raw pointer/keyboard events to it,
 * manages lifecycle (activate/deactivate), spring-loaded temporary
 * tool switching, modifier key tracking, and cursor resolution.
 *
 * Research basis: Figma's tool controller, W3C APG Toolbar pattern.
 *                 Spring-loaded tools: holding a key activates the tool
 *                 temporarily, reverting on release (Space=Hand pattern).
 */
import { interactionSession, type TabletControlSnapshot } from './InteractionContext';
import { CanvasNudgeController } from './nudgeController';
import type { GestureResult, Tool, ToolContext, ToolCursorState, ToolId } from './types';

export type ToolFactory = () => Tool;

const SPRING_LOAD_DELAY_MS = 150;
const FROM_CENTER_TOOLS = new Set<ToolId>([
  'frame',
  'panel',
  'rect',
  'ellipse',
  'polygon',
  'star',
  'line',
  'arrow',
  'text',
  'table',
]);

interface SpringLoadState {
  previousId: ToolId;
  previousTool: Tool;
  targetId: ToolId;
  timer: ReturnType<typeof setTimeout> | null;
  key: string;
}

export class ToolManager {
  private factories = new Map<ToolId, ToolFactory>();
  private instances = new Map<ToolId, Tool>();
  private activeId: ToolId;
  private cursorState: ToolCursorState = 'idle';
  private spring: SpringLoadState | null = null;
  private _shiftKey = false;
  private _altKey = false;
  private _ctrlKey = false;
  private _metaKey = false;
  private genericNudge = new CanvasNudgeController();
  /** Pointer driving an in-progress middle-button pan, when any. */
  private middlePanPointerId: number | null = null;
  /** Latches are captured at pointer-down so a second contact cannot alter a live gesture. */
  private pointerModifiers = new Map<number, TabletControlSnapshot>();

  constructor(defaultTool: ToolId = 'select') {
    this.activeId = defaultTool;
  }

  register(id: ToolId, factory: ToolFactory): void {
    this.factories.set(id, factory);
  }

  private getOrCreate(id: ToolId): Tool {
    let tool = this.instances.get(id);
    if (!tool) {
      const factory = this.factories.get(id);
      if (!factory) throw new Error(`Unknown tool: ${id}`);
      tool = factory();
      this.instances.set(id, tool);
    }
    return tool;
  }

  get activeTool(): Tool {
    return this.getOrCreate(this.activeId);
  }

  get activeToolId(): ToolId {
    return this.activeId;
  }

  /** Return a previously-activated tool instance without forcing instantiation. */
  getTool<T extends Tool = Tool>(id: ToolId): T | undefined {
    return this.instances.get(id) as T | undefined;
  }

  setTool(id: ToolId, ctx?: ToolContext): void {
    if (id === this.activeId) return;
    if (ctx) this.genericNudge.finish(ctx);
    const prev = this.activeTool;
    const previousToolId = this.activeId;
    this.activeId = id;
    const next = this.activeTool;
    if (ctx) {
      prev.onDeactivate?.(ctx);
      next.onActivate?.({ ...ctx, previousToolId });
    } else {
      // When called without context (e.g. during initialization), we do not
      // call lifecycle hooks — they require a valid context to avoid crashes
      // (e.g. SelectTool.onDeactivate calls abortTransaction on ctx).
    }
    this.cursorState = 'idle';
  }

  springLoadTool(id: ToolId, e: KeyboardEvent, ctx: ToolContext): void {
    // Ignore key-repeat re-arms while the same spring is held.
    if (this.spring?.key === e.key) return;
    if (this.spring) this.releaseSpring(ctx);
    if (this.activeId === id) return;
    this.genericNudge.finish(ctx);
    const prevId = this.activeId;
    const prevTool = this.activeTool;
    const timer = setTimeout(() => {
      prevTool.onDeactivate?.(ctx);
      this.activeId = id;
      const next = this.getOrCreate(id);
      next.onActivate?.(ctx);
      this.spring = {
        previousId: prevId,
        previousTool: prevTool,
        targetId: id,
        timer: null,
        key: e.key,
      };
      this.cursorState = 'idle';
      ctx.announce(`${id} tool active`);
    }, SPRING_LOAD_DELAY_MS);
    this.spring = { previousId: prevId, previousTool: prevTool, targetId: id, timer, key: e.key };
  }

  /** True while a spring-loaded (temporary) tool is armed or active. */
  get springActive(): boolean {
    return this.spring !== null;
  }

  get springKey(): string | null {
    return this.spring?.key ?? null;
  }

  releaseSpring(ctx: ToolContext): void {
    if (!this.spring) return;
    if (this.spring.timer !== null) clearTimeout(this.spring.timer);
    if (this.activeId === this.spring.targetId) {
      // Spring had activated — revert to the previous tool.
      const current = this.activeTool;
      current.onDeactivate?.(ctx);
      this.activeId = this.spring.previousId;
      this.spring.previousTool.onActivate?.(ctx);
    }
    this.spring = null;
    this.cursorState = 'idle';
  }

  get cursor(): string {
    // A middle-button pan is a Hand-tool drag even under another active tool;
    // reflect the grabbing cursor so the viewport navigation is visible.
    const spec =
      this.middlePanPointerId !== null
        ? this.getOrCreate('hand').cursor('drag')
        : this.activeTool.cursor(this.cursorState);
    return spec.css;
  }

  get shiftKey(): boolean {
    return this._shiftKey;
  }
  get altKey(): boolean {
    return this._altKey;
  }
  get ctrlKey(): boolean {
    return this._ctrlKey;
  }
  get metaKey(): boolean {
    return this._metaKey;
  }

  updateModifiers(e: {
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  }): void {
    this._shiftKey = e.shiftKey;
    this._altKey = e.altKey;
    this._ctrlKey = e.ctrlKey;
    this._metaKey = e.metaKey;
  }

  /**
   * Clear all tracked modifier state. Called on window blur and
   * visibilitychange to prevent stuck modifiers when a key release
   * occurs outside the application window.
   */
  resetModifiers(): void {
    this._shiftKey = false;
    this._altKey = false;
    this._ctrlKey = false;
    this._metaKey = false;
    this.pointerModifiers.clear();
  }

  private buildContext(e: PointerEvent | KeyboardEvent, base: ToolContext): ToolContext {
    this.updateModifiers(e);
    const latched = 'pointerId' in e ? this.getPointerModifiers(e) : undefined;
    return {
      ...base,
      shiftKey: this._shiftKey || (latched?.constrain ?? false),
      // Alt-drag on Select duplicates. Keep that established gesture intact;
      // the latched from-centre modifier applies to creation/edit tools.
      altKey:
        this._altKey || ((latched?.fromCenter ?? false) && FROM_CENTER_TOOLS.has(this.activeId)),
      ctrlKey: this._ctrlKey,
      metaKey: this._metaKey,
    };
  }

  private getPointerModifiers(e: PointerEvent): TabletControlSnapshot {
    return this.pointerModifiers.get(e.pointerId) ?? interactionSession.getControlSnapshot();
  }

  private withLatchedPointerModifiers(
    e: PointerEvent,
    latched = this.getPointerModifiers(e),
  ): PointerEvent {
    const fromCenter = latched.fromCenter && FROM_CENTER_TOOLS.has(this.activeId);
    if (!latched.constrain && !fromCenter) return e;
    return new Proxy(e, {
      get(target, property) {
        if (property === 'shiftKey') return target.shiftKey || latched.constrain;
        if (property === 'altKey') return target.altKey || fromCenter;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  handlePointerDown(e: PointerEvent, base: ToolContext): GestureResult {
    this.pointerModifiers.set(e.pointerId, interactionSession.getControlSnapshot());
    e = this.withLatchedPointerModifiers(e, this.pointerModifiers.get(e.pointerId));
    const ctx = this.buildContext(e, base);
    // The middle button is viewport navigation wherever it lands (the
    // Figma/Illustrator convention): route it to the Hand tool even under
    // another active tool so one-handed panning never depends on the tool
    // selection. Escape, blur, pointercancel, and release momentum then flow
    // through the Hand tool's ordinary drag lifecycle.
    if (e.button === 1 && this.activeId !== 'hand') {
      const hand = this.getOrCreate('hand');
      const result = hand.onPointerDown?.(e, ctx) ?? { consumed: false };
      if (result.consumed) {
        this.middlePanPointerId = e.pointerId;
        this.cursorState = 'drag';
        return result;
      }
    }
    // The right button belongs to context actions (input-system behavior
    // matrix): it must never start a tool gesture. Routing it to the active
    // tool let a right-click with a creation tool commit artwork, and the
    // selection/state change from that commit immediately closed the canvas
    // context menu the same click was meant to open.
    if (e.button === 2) {
      this.pointerModifiers.delete(e.pointerId);
      return { consumed: false };
    }
    this.cursorState = 'drag';
    const result = this.activeTool.onPointerDown?.(e, ctx) ?? { consumed: false };
    if (!result.consumed) this.pointerModifiers.delete(e.pointerId);
    return result;
  }

  handlePointerMove(e: PointerEvent, base: ToolContext): void {
    e = this.withLatchedPointerModifiers(e);
    const ctx = this.buildContext(e, base);
    if (this.cursorState === 'idle') this.cursorState = 'hover';
    if (this.middlePanPointerId !== null && this.middlePanPointerId === e.pointerId) {
      this.getOrCreate('hand').onPointerMove?.(e, ctx);
      return;
    }
    this.activeTool.onPointerMove?.(e, ctx);
  }

  handlePointerUp(e: PointerEvent, base: ToolContext): void {
    const pointerId = e.pointerId;
    e = this.withLatchedPointerModifiers(e);
    const ctx = this.buildContext(e, base);
    this.cursorState = 'idle';
    try {
      if (this.middlePanPointerId !== null && this.middlePanPointerId === e.pointerId) {
        this.middlePanPointerId = null;
        this.getOrCreate('hand').onPointerUp?.(e, ctx);
        return;
      }
      this.activeTool.onPointerUp?.(e, ctx);
    } finally {
      this.pointerModifiers.delete(pointerId);
    }
  }

  handlePointerCancel(e: PointerEvent, base: ToolContext): void {
    e = this.withLatchedPointerModifiers(e);
    const ctx = this.buildContext(e, base);
    this.cursorState = 'idle';
    // A cancel ends an in-progress middle pan (its pointer may no longer
    // exist, so match on the pan being open rather than the event id) while
    // the active tool's own drag keeps its existing cancel contract.
    try {
      if (this.middlePanPointerId !== null) {
        this.middlePanPointerId = null;
        this.getOrCreate('hand').onPointerCancel?.(e, ctx);
      }
      this.activeTool.onPointerCancel?.(e, ctx);
    } finally {
      this.pointerModifiers.clear();
    }
  }

  handleKeyDown(e: KeyboardEvent, base: ToolContext): boolean {
    const ctx = this.buildContext(e, base);

    // Escape belongs to an active keyboard movement before it can reach the
    // selection tool. This keeps nudge completion from also clearing the
    // selection or cancelling an unrelated selection gesture.
    if (e.key === 'Escape' && this.genericNudge.active) {
      this.genericNudge.finish(ctx);
      return true;
    }

    const consumed = this.activeTool.onKeyDown?.(e, ctx) ?? false;
    if (consumed) return true;

    // Idle creation/navigation tools deliberately decline object arrows. The
    // generic controller is the canvas fallback after specialized tools have
    // had first refusal, so creation-tool focus no longer disables nudging.
    return this.genericNudge.handleKeyDown(e, ctx);
  }

  handleKeyUp(e: KeyboardEvent, base: ToolContext): void {
    const ctx = this.buildContext(e, base);
    this.activeTool.onKeyUp?.(e, ctx);
    this.genericNudge.handleKeyUp(e, ctx);
  }

  /** Let the active tool finish keyboard-owned gestures after focus loss. */
  handleFocusLoss(base: ToolContext): void {
    this.cursorState = 'idle';
    this.activeTool.onFocusLoss?.(base);
    this.genericNudge.finish(base);
    this.pointerModifiers.clear();
  }

  handleDoubleClick(e: PointerEvent, base: ToolContext): void {
    e = this.withLatchedPointerModifiers(e);
    const ctx = this.buildContext(e, base);
    this.activeTool.onDoubleClick?.(e, ctx);
  }
}
