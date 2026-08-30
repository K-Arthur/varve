export const VARVE_NODE_MIME = 'application/x-varve-node';
export const VARVE_FILE_MIME = 'application/x-varve-file';
export const LEGACY_NODE_MIME = 'application/x-strata-node';
export const LEGACY_FILE_MIME = 'application/x-strata-file';

export interface DragNodeData {
  type: 'layer';
  nodeId: string;
  parentId: string | null;
}

export interface DragFileData {
  type: 'file';
  fileId: string;
  name: string;
}

/** A layer-row appearance badge being copied to another layer. */
export interface DragEffectStackData {
  type: 'effect-stack';
  sourceId: string;
  stackKind: import('@varve/scene').EffectStackKind;
  /** Alt/Option preserves the target stack and adds after it. */
  transferMode: import('@varve/scene').EffectStackTransferMode;
}

export type DragData = DragNodeData | DragFileData | DragEffectStackData;
