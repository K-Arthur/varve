import type { NodeId } from '@varve/scene';

/** Active table edit session (ADR-0016): cell selection + keyboard focus. */
export interface TableEditState {
  tableId: NodeId;
  /** Selected cell ids (single cell or rectangular range). */
  cellIds: string[];
  /** Keyboard cursor cell (may be inside a span owner). */
  activeCellId: string | null;
  /** Cell with the inline text editor open. */
  editingCellId: string | null;
  /** Range anchor for shift-extended selections. */
  anchorCellId: string | null;
}
