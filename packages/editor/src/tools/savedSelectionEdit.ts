import type { Document } from '@varve/scene';

/** Saved coverage resources participate in persistent document history. */
export function savedSelectionEdit(
  ports: {
    beginTransaction: () => void;
    commitTransaction: () => void;
    abortTransaction: () => void;
    updateDoc: (update: (doc: Document) => Document) => void;
  },
  update: (doc: Document) => Document,
): void {
  ports.beginTransaction();
  try {
    ports.updateDoc(update);
    ports.commitTransaction();
  } catch (error) {
    ports.abortTransaction();
    throw error;
  }
}
