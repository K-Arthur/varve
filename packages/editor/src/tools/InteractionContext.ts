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
  readonly preferences: Readonly<SnapPreferences>;
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

  begin(inputSource: InputSource, operation: OperationType, snapEnabled: boolean): void {
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
    this._frozen = Object.freeze({
      shiftKey: this._shiftKey,
      altKey: this._altKey,
      ctrlKey: this._ctrlKey,
      metaKey: this._metaKey,
      inputSource: this._inputSource,
      operation: this._operation,
      axisLock: this._axisLock,
      isDuplicate: this._isDuplicate,
      snapEnabled: this._snapEnabled,
      bypassSnap: this.cmdKey,
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
  }
}

export const interactionSession = new InteractionSession();
