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
import type { Tool, ToolContext, ToolCursorState, ToolId, GestureResult } from './types';

export type ToolFactory = () => Tool;

const SPRING_LOAD_DELAY_MS = 150;

interface SpringLoadState {
  previousId: ToolId;
  previousTool: Tool;
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

  setTool(id: ToolId, ctx?: ToolContext): void {
    if (id === this.activeId) return;
    const prev = this.activeTool;
    prev.onDeactivate?.(ctx ?? ({} as ToolContext));
    this.activeId = id;
    const next = this.activeTool;
    next.onActivate?.(ctx ?? ({} as ToolContext));
    this.cursorState = 'idle';
  }

  springLoadTool(id: ToolId, e: KeyboardEvent, ctx: ToolContext): void {
    if (this.spring) this.releaseSpring(ctx);
    const prevId = this.activeId;
    const prevTool = this.activeTool;
    const timer = setTimeout(() => {
      prevTool.onDeactivate?.(ctx);
      this.activeId = id;
      const next = this.getOrCreate(id);
      next.onActivate?.(ctx);
      this.spring = { previousId: prevId, previousTool: prevTool, timer: null, key: e.key };
      this.cursorState = 'idle';
    }, SPRING_LOAD_DELAY_MS);
    this.spring = { previousId: prevId, previousTool: prevTool, timer, key: e.key };
  }

  releaseSpring(ctx: ToolContext): void {
    if (!this.spring) return;
    if (this.spring.timer !== null) clearTimeout(this.spring.timer);
    if (this.activeId !== this.spring.key.toLowerCase()) {
      // Spring hadn't activated yet; do nothing
    } else {
      const current = this.activeTool;
      current.onDeactivate?.(ctx);
      this.activeId = this.spring.previousId;
      this.spring.previousTool.onActivate?.(ctx);
    }
    this.spring = null;
    this.cursorState = 'idle';
  }

  get cursor(): string {
    const spec = this.activeTool.cursor(this.cursorState);
    return spec.css;
  }

  get shiftKey(): boolean { return this._shiftKey; }
  get altKey(): boolean { return this._altKey; }
  get ctrlKey(): boolean { return this._ctrlKey; }
  get metaKey(): boolean { return this._metaKey; }

  updateModifiers(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
    this._shiftKey = e.shiftKey;
    this._altKey = e.altKey;
    this._ctrlKey = e.ctrlKey;
    this._metaKey = e.metaKey;
  }

  private buildContext(
    e: PointerEvent | KeyboardEvent,
    base: ToolContext,
  ): ToolContext {
    this.updateModifiers(e);
    return {
      ...base,
      shiftKey: this._shiftKey,
      altKey: this._altKey,
      ctrlKey: this._ctrlKey,
      metaKey: this._metaKey,
    };
  }

  handlePointerDown(e: PointerEvent, base: ToolContext): GestureResult {
    const ctx = this.buildContext(e, base);
    this.cursorState = 'drag';
    return this.activeTool.onPointerDown?.(e, ctx) ?? { consumed: false };
  }

  handlePointerMove(e: PointerEvent, base: ToolContext): void {
    const ctx = this.buildContext(e, base);
    if (this.cursorState === 'idle') this.cursorState = 'hover';
    this.activeTool.onPointerMove?.(e, ctx);
  }

  handlePointerUp(e: PointerEvent, base: ToolContext): void {
    const ctx = this.buildContext(e, base);
    this.cursorState = 'idle';
    this.activeTool.onPointerUp?.(e, ctx);
  }

  handlePointerCancel(e: PointerEvent, base: ToolContext): void {
    const ctx = this.buildContext(e, base);
    this.cursorState = 'idle';
    this.activeTool.onPointerCancel?.(e, ctx);
  }

  handleKeyDown(e: KeyboardEvent, base: ToolContext): boolean {
    const ctx = this.buildContext(e, base);
    ctx.shiftKey = this._shiftKey;
    ctx.altKey = this._altKey;
    ctx.ctrlKey = this._ctrlKey;
    ctx.metaKey = this._metaKey;

    const consumed = this.activeTool.onKeyDown?.(e, ctx) ?? false;
    if (consumed) return true;

    return false;
  }

  handleKeyUp(e: KeyboardEvent, base: ToolContext): void {
    const ctx = this.buildContext(e, base);
    this.activeTool.onKeyUp?.(e, ctx);
  }

  handleDoubleClick(e: PointerEvent, base: ToolContext): void {
    const ctx = this.buildContext(e, base);
    this.activeTool.onDoubleClick?.(e, ctx);
  }
}
