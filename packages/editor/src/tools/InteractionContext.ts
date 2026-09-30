import { isMac } from '@varve/platform';

export type InputSource = 'mouse' | 'pen' | 'touch' | 'keyboard';
export type AxisLock = 'none' | 'x' | 'y';
export type OperationType = 'move' | 'resize' | 'rotate' | 'duplicate-drag' | 'nudge' | 'guides';

export interface InteractionSnapshot {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly inputSource: InputSource;
  readonly operation: OperationType;
  readonly axisLock: AxisLock;
  readonly isDuplicate: boolean;
  readonly snapEnabled: boolean;
  readonly bypassSnap: boolean;
  readonly fromCenter: boolean;
  /** Ctrl/Cmd+Shift preserves the current parent while dragging. */
  readonly preserveParent: boolean;
  readonly preferences: Readonly<SnapPreferences>;
}

export type LatchedToolModifier = 'constrain' | 'fromCenter' | 'bypassSnap';

export interface TabletControlSnapshot {
  readonly constrain: boolean;
  readonly fromCenter: boolean;
  readonly bypassSnap: boolean;
  readonly deepSelectArmed: boolean;
}

export interface SnapPreferences {
  snapToGrid: boolean;
  snapToGuides: boolean;
  snapToObjects: boolean;
  snapToPixel: boolean;
  snapToBaseline: boolean;
  snapToLayoutGrid: boolean;
}

export class InteractionSession {
  private _shiftKey = false;
  private _altKey = false;
  private _ctrlKey = false;
  private _metaKey = false;
  private _inputSource: InputSource = 'mouse';
  private _operation: OperationType = 'move';
  private _axisLock: AxisLock = 'none';
  private _isDuplicate = false;
  private _snapEnabled = true;
  private _preferences: SnapPreferences = {
    snapToGrid: true,
    snapToGuides: true,
    snapToObjects: true,
    snapToPixel: false,
    snapToBaseline: true,
    snapToLayoutGrid: true,
  };
  private _frozen: InteractionSnapshot | null = null;
  private _controlSnapshot: TabletControlSnapshot = Object.freeze({
    constrain: false,
    fromCenter: false,
    bypassSnap: false,
    deepSelectArmed: false,
  });
  private _activeControlSnapshot: TabletControlSnapshot | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getControlSnapshot = (): TabletControlSnapshot => this._controlSnapshot;

  setLatchedModifier(modifier: LatchedToolModifier, enabled: boolean): void {
    if (this._controlSnapshot[modifier] === enabled) return;
    this.updateControlSnapshot({ [modifier]: enabled });
    this._frozen = null;
  }

  armDeepSelect(enabled: boolean): void {
    if (this._controlSnapshot.deepSelectArmed === enabled) return;
    this.updateControlSnapshot({ deepSelectArmed: enabled });
  }

  consumeDeepSelect(): boolean {
    const armed = this._controlSnapshot.deepSelectArmed;
    if (armed) this.armDeepSelect(false);
    return armed;
  }

  private updateControlSnapshot(patch: Partial<TabletControlSnapshot>): void {
    this._controlSnapshot = Object.freeze({ ...this._controlSnapshot, ...patch });
    for (const listener of this.listeners) listener();
  }

  begin(inputSource: InputSource, operation: OperationType, snapEnabled: boolean): void {
    this._activeControlSnapshot = this._controlSnapshot;
    this._inputSource = inputSource;
    this._operation = operation;
    this._snapEnabled = snapEnabled;
    this._isDuplicate = false;
    this._axisLock = 'none';
    this._frozen = null;
  }

  updateModifiers(shiftKey: boolean, altKey: boolean, ctrlKey: boolean, metaKey: boolean): void {
    this._shiftKey = shiftKey;
    this._altKey = altKey;
    this._ctrlKey = ctrlKey;
    this._metaKey = metaKey;
    this._frozen = null;
  }

  setDuplicate(v: boolean): void {
    this._isDuplicate = v;
    this._frozen = null;
  }
  setAxisLock(lock: AxisLock): void {
    this._axisLock = lock;
    this._frozen = null;
  }
  setOperation(op: OperationType): void {
    this._operation = op;
    this._frozen = null;
  }
  setSnapEnabled(v: boolean): void {
    this._snapEnabled = v;
    this._frozen = null;
  }

  get cmdKey(): boolean {
    return isMac() ? this._metaKey : this._ctrlKey;
  }

  freeze(): InteractionSnapshot {
    if (this._frozen) return this._frozen;
    const latched = this._activeControlSnapshot ?? this._controlSnapshot;
    this._frozen = Object.freeze({
      shiftKey: this._shiftKey || latched.constrain,
      altKey: this._altKey,
      ctrlKey: this._ctrlKey,
      metaKey: this._metaKey,
      inputSource: this._inputSource,
      operation: this._operation,
      axisLock: this._axisLock,
      isDuplicate: this._isDuplicate,
      snapEnabled: this._snapEnabled,
      // Ctrl/Cmd is the snap bypass. Adding Shift changes the intent to
      // preserve-parent, so snap bypass and reparent suppression are no
      // longer coupled to one opaque flag.
      bypassSnap: latched.bypassSnap || (this.cmdKey && !this._shiftKey),
      fromCenter: latched.fromCenter,
      preserveParent: this.cmdKey && this._shiftKey,
      preferences: Object.freeze({ ...this._preferences }),
    });
    return this._frozen;
  }

  reset(): void {
    this._shiftKey = false;
    this._altKey = false;
    this._ctrlKey = false;
    this._metaKey = false;
    this._inputSource = 'mouse';
    this._operation = 'move';
    this._axisLock = 'none';
    this._isDuplicate = false;
    this._snapEnabled = true;
    this._frozen = null;
    this._activeControlSnapshot = null;
    this.armDeepSelect(false);
  }
}

export const interactionSession = new InteractionSession();
