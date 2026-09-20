/** Inspector controls for a parametric comic callout group. */
import type { CalloutFitPolicy, CalloutKind, GroupNode, TextWrapShape } from '@varve/scene';
import {
  addCalloutTail,
  detachCalloutRecipe,
  fitCalloutToText,
  getCalloutFitReport,
  setCalloutFitPolicy,
  setCalloutWrapShape,
  updateCalloutKind,
  updateCalloutPadding,
  updateCalloutTailEndpoint,
} from '@varve/scene';
import { Button, Select } from '@varve/ui';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import type { SectionId } from '../sectionRegistry';

const KIND_OPTIONS: readonly { value: CalloutKind; label: string; description: string }[] = [
  { value: 'speech', label: 'Speech', description: 'Rounded balloon with a pointed tail' },
  { value: 'thought', label: 'Thought', description: 'Soft balloon styling for internal dialogue' },
  { value: 'caption', label: 'Caption', description: 'Compact editorial caption box' },
  { value: 'whisper', label: 'Whisper', description: 'Dashed outline for a quiet voice' },
  { value: 'shout', label: 'Shout', description: 'Heavy outline for emphasis' },
];

const FIT_OPTIONS = [
  {
    value: 'reflow',
    label: 'Reflow in balloon',
    description: 'Keep the body and font size; wrap the text.',
  },
  {
    value: 'fit-balloon',
    label: 'Fit balloon to text',
    description: 'Grow the body without shrinking the type.',
  },
  {
    value: 'overflow',
    label: 'Show overflow',
    description: 'Keep authored geometry and warn when text exceeds it.',
  },
] as const;

const WRAP_SHAPE_OPTIONS: readonly {
  value: TextWrapShape;
  label: string;
  description: string;
}[] = [
  {
    value: 'ellipse',
    label: 'Balloon contour',
    description: 'Narrow the first and last lines so the stack follows a round balloon.',
  },
  {
    value: 'rect',
    label: 'Rectangle',
    description: 'Wrap every line to the full interior width.',
  },
];

export function CalloutSection({ node, sectionId }: { node: GroupNode; sectionId?: SectionId }) {
  const editor = useEditor();
  const callout = node.callout;
  const fitReport = callout ? getCalloutFitReport(editor.state.document, node.id) : null;
  const firstTail = callout ? editor.state.document.nodes[callout.tailNodeIds[0]!] : undefined;
  const endpoint =
    firstTail?.kind === 'path' && firstTail.points.length > 0
      ? firstTail.points[firstTail.points.length - 1]
      : undefined;

  const mutate = useCallback(
    (
      label: string,
      operation: (document: import('@varve/scene').Document) => import('@varve/scene').Document,
    ) => {
      editor.groupCompoundOperation(label, () => editor.updateDoc(operation));
    },
    [editor],
  );

  if (!callout) return null;

  return (
    <DisclosureSection title="Comic balloon" sectionId={sectionId} summary={callout.kind}>
      <p className="insp-hint">
        The balloon body and tail are ordinary editable nodes. Text stays bound to its source story
        and can be restyled independently.
      </p>
      <FieldRow label="Style">
        <Select
          label="Balloon style"
          value={callout.kind}
          options={KIND_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            description: option.description,
          }))}
          onChange={(value) =>
            mutate('Change balloon style', (document) =>
              updateCalloutKind(document, node.id, value as CalloutKind),
            )
          }
        />
      </FieldRow>
      <NumberField
        label="Text padding"
        unit="px"
        value={callout.padding}
        min={0}
        step={1}
        onChange={(value) =>
          mutate('Change balloon padding', (document) =>
            updateCalloutPadding(document, node.id, value),
          )
        }
      />
      <FieldRow label="Line shape">
        <Select
          label="Balloon line shape"
          value={fitReport?.wrapShape ?? 'rect'}
          options={WRAP_SHAPE_OPTIONS.map((option) => ({ ...option }))}
          onChange={(value) =>
            mutate('Change balloon line shape', (document) =>
              setCalloutWrapShape(document, node.id, value as TextWrapShape),
            )
          }
        />
      </FieldRow>
      <FieldRow label="Fit policy">
        <Select
          label="Balloon fit policy"
          value={fitReport?.policy ?? callout.fitPolicy ?? 'reflow'}
          options={FIT_OPTIONS.map((option) => ({ ...option }))}
          onChange={(value) =>
            mutate('Change balloon fit policy', (document) =>
              setCalloutFitPolicy(document, node.id, value as CalloutFitPolicy),
            )
          }
        />
      </FieldRow>
      {fitReport && (
        <p className="insp-hint" role="status" data-callout-fit-status={fitReport.status}>
          {fitReport.status === 'fit'
            ? 'Dialogue fits with the current padding.'
            : fitReport.status === 'near-overflow'
              ? 'Dialogue is close to the balloon edge.'
              : `Dialogue exceeds the usable area by ${Math.ceil(Math.max(fitReport.excessWidth, fitReport.excessHeight))} px.`}
        </p>
      )}
      {endpoint && callout.tailNodeIds[0] && (
        <div className="insp-field-group">
          <FieldRow label="Tail endpoint">
            <div className="insp-field-group insp-field-group--row">
              <NumberField
                label="Tail X"
                unit="px"
                value={endpoint.x}
                onChange={(value) =>
                  mutate('Move balloon tail', (document) =>
                    updateCalloutTailEndpoint(document, node.id, callout.tailNodeIds[0]!, {
                      x: value,
                      y: endpoint.y,
                    }),
                  )
                }
              />
              <NumberField
                label="Tail Y"
                unit="px"
                value={endpoint.y}
                onChange={(value) =>
                  mutate('Move balloon tail', (document) =>
                    updateCalloutTailEndpoint(document, node.id, callout.tailNodeIds[0]!, {
                      x: endpoint.x,
                      y: value,
                    }),
                  )
                }
              />
            </div>
          </FieldRow>
        </div>
      )}
      <div className="insp-field-group">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            mutate('Fit balloon to text', (document) => fitCalloutToText(document, node.id))
          }
        >
          Fit balloon to text
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            mutate('Detach balloon recipe', (document) => detachCalloutRecipe(document, node.id))
          }
          disabled={!callout.parametric}
        >
          Detach geometry
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            mutate('Add balloon tail', (document) => addCalloutTail(document, node.id))
          }
        >
          Add tail
        </Button>
      </div>
      <p className="insp-hint">
        {callout.tailNodeIds.length} tail{callout.tailNodeIds.length === 1 ? '' : 's'} ·{' '}
        {callout.parametric ? 'parametric recipe active' : 'geometry detached'}
      </p>
    </DisclosureSection>
  );
}
