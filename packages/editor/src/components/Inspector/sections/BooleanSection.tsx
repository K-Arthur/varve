import {
  type GroupNode,
  isBooleanOperand,
  isLiveBooleanNode,
  type LiveBooleanOperation,
  removeNode,
  type SceneNode,
} from '@varve/scene';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

const OPERATIONS: readonly { value: LiveBooleanOperation; label: string }[] = [
  { value: 'union', label: 'Union' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'intersect', label: 'Intersect' },
  { value: 'exclude', label: 'Exclude overlap' },
];

/** Pathfinder controls for a live Boolean group and its ordered operands. */
export function BooleanSection({ node }: { node: GroupNode }) {
  const editor = useEditor();
  if (!isLiveBooleanNode(node)) return null;

  const operands = node.children
    .map((id) => editor.state.document.nodes[id])
    .filter((operand): operand is NonNullable<typeof operand> => operand !== undefined);
  const isInside = (candidate: SceneNode, targetId: string, seen = new Set<string>()): boolean => {
    if (!('children' in candidate) || seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return candidate.children.some((childId) => {
      if (childId === targetId) return true;
      const child = editor.state.document.nodes[childId];
      return child ? isInside(child, targetId, seen) : false;
    });
  };
  const availableOperands = Object.values(editor.state.document.nodes).filter(
    (candidate) =>
      candidate.id !== node.id &&
      !node.children.includes(candidate.id) &&
      isBooleanOperand(candidate) &&
      !isInside(candidate, node.id),
  );

  const setOperation = (operation: LiveBooleanOperation) => {
    editor.beginTransaction();
    editor.updateNode(node.id, (current) =>
      isLiveBooleanNode(current)
        ? {
            ...current,
            name: `Boolean ${operation[0]!.toUpperCase()}${operation.slice(1)}`,
            boolean: { ...current.boolean, operation },
          }
        : current,
    );
    editor.commitTransaction();
  };

  const removeOperand = (operandId: string) => {
    if (operands.length <= 2) return;
    editor.beginTransaction();
    editor.updateDoc((doc) => removeNode(doc, operandId));
    editor.commitTransaction();
  };

  const addOperand = (operandId: string) => {
    editor.beginTransaction();
    editor.reparentNode(operandId, node.id, node.children.length);
    editor.commitTransaction();
  };

  return (
    <DisclosureSection title="Pathfinder" id="pathfinder-boolean">
      <div className="insp-field">
        <label className="insp-field__label" htmlFor={`pathfinder-operation-${node.id}`}>
          Operation
        </label>
        <div className="insp-field__control">
          <select
            id={`pathfinder-operation-${node.id}`}
            aria-label="Boolean operation"
            value={node.boolean.operation}
            onChange={(event) => setOperation(event.target.value as LiveBooleanOperation)}
          >
            {OPERATIONS.map((operation) => (
              <option key={operation.value} value={operation.value}>
                {operation.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ol
        aria-label="Boolean operands"
        style={{
          display: 'grid',
          gap: 'var(--space-1)',
          margin: 'var(--space-2) 0 0',
          padding: 0,
          listStyle: 'none',
        }}
      >
        {operands.map((operand, index) => (
          <li
            key={operand.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              padding: 'var(--space-1)',
              background: 'var(--color-surface-sunken)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                editor.enterIsolation(node.id);
                editor.toggleSelection(operand.id, false);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textAlign: 'left',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--color-text-primary)',
              }}
              aria-label={`Edit operand ${index + 1}: ${operand.name}`}
            >
              {index + 1}. {operand.name}
            </button>
            <button
              type="button"
              onClick={() => removeOperand(operand.id)}
              disabled={operands.length <= 2}
              aria-label={`Remove operand ${operand.name}`}
              title={operands.length <= 2 ? 'A Boolean needs at least two operands' : undefined}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>

      {availableOperands.length > 0 && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <span className="insp-field__label">Add operand</span>
          <div style={{ display: 'grid', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
            {availableOperands.slice(0, 8).map((candidate) => (
              <button
                type="button"
                key={candidate.id}
                onClick={() => addOperand(candidate.id)}
                aria-label={`Add operand ${candidate.name}`}
              >
                + {candidate.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
        <button
          type="button"
          onClick={() => {
            editor.enterIsolation(node.id);
            editor.selectChildren();
          }}
          aria-label="Edit Boolean operands"
        >
          Edit operands
        </button>
        <button type="button" onClick={() => editor.ungroupSelected()}>
          Expand Boolean
        </button>
      </div>
    </DisclosureSection>
  );
}
