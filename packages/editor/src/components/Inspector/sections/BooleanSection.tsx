import {
  type GroupNode,
  isBooleanOperand,
  isLiveBooleanNode,
  type LiveBooleanOperation,
  removeNode,
  type SceneNode,
} from '@varve/scene';
import { Button, Select } from '@varve/ui';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';

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
    <DisclosureSection title="Pathfinder" sectionId="boolean">
      <FieldRow label="Operation">
        <Select
          label="Boolean operation"
          value={node.boolean.operation}
          options={OPERATIONS.map((operation) => ({
            value: operation.value,
            label: operation.label,
          }))}
          onChange={(next) => setOperation(next as LiveBooleanOperation)}
        />
      </FieldRow>

      <ol className="insp-boolean__operands" aria-label="Boolean operands">
        {operands.map((operand, index) => (
          <li key={operand.id} className="insp-boolean__operand">
            <Button
              variant="ghost"
              size="sm"
              className="insp-boolean__operand-name"
              onClick={() => {
                editor.enterIsolation(node.id);
                editor.toggleSelection(operand.id, false);
              }}
              aria-label={`Edit operand ${index + 1}: ${operand.name}`}
            >
              {index + 1}. {operand.name}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeOperand(operand.id)}
              disabled={operands.length <= 2}
              aria-label={`Remove operand ${operand.name}`}
              title={operands.length <= 2 ? 'A Boolean needs at least two operands' : undefined}
            >
              Remove
            </Button>
          </li>
        ))}
      </ol>

      {availableOperands.length > 0 && (
        <div className="insp-boolean__add">
          <span className="insp-boolean__add-label">Add operand</span>
          <div className="insp-boolean__add-list">
            {availableOperands.slice(0, 8).map((candidate) => (
              <Button
                variant="secondary"
                size="sm"
                key={candidate.id}
                className="insp-boolean__add-btn"
                onClick={() => addOperand(candidate.id)}
                aria-label={`Add operand ${candidate.name}`}
              >
                + {candidate.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="insp-boolean__actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            editor.enterIsolation(node.id);
            editor.selectChildren();
          }}
          aria-label="Edit Boolean operands"
        >
          Edit operands
        </Button>
        <Button variant="secondary" size="sm" onClick={() => editor.ungroupSelected()}>
          Expand Boolean
        </Button>
      </div>
    </DisclosureSection>
  );
}
