export const STRATA_NODE_MIME = 'application/x-strata-node';
export const STRATA_FILE_MIME = 'application/x-strata-file';

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
