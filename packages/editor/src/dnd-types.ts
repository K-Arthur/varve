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

export type DragData = DragNodeData | DragFileData;
