/**
 * TableAppearanceSection — table paint variable binding + alpha modifiers
 * (ADR-0016 §12, §16).
 *
 * Each appearance paint (header/body/alternate fills, border/divider
 * colors, header/body text) can be linked to a color variable through the
 * same binding pipeline as node fills: shift-click or the link button opens
 * the BindingMenu; a binding shows a badge with the variable name and an
 * alpha-modifier label; clicking the badge opens the VariableModifierPopover.
 *
 * The binding keys are `table.headerFill` … — resolved non-destructively by
 * applyBindingsToNode; changing the variable or mode re-resolves every paint
 * without materializing literals.
 */
import type { PropertyBinding, TableModel } from '@varve/scene';
import {
  alphaModifierLabel,
  resolveBoundTokenColor,
  TABLE_PAINT_BINDING_KEYS,
  type TablePaintKey,
} from '@varve/scene';
import { Icon } from '@varve/ui';
import { useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { docVariableStore } from '../../../docVariableStore';
import { BindingMenu } from '../controls/BindingMenu';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';
import { VariableModifierPopover } from '../controls/VariableModifierPopover';

interface Props {
  tableId: string;
  table: TableModel;
  onSetAppearance: (fn: (model: TableModel) => TableModel) => void;
  /** Set a binding on the table node (via editor.setSelectedBinding). */
  onSetBinding: (property: string, binding: PropertyBinding | null) => void;
}

interface ModifierState {
  tokenColor: import('@varve/scene').ManagedColor;
  binding: PropertyBinding;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const PAINT_LABELS: Record<TablePaintKey, string> = {
  'table.headerFill': 'Header fill',
  'table.bodyFill': 'Body fill',
  'table.alternateFill': 'Alternate fill',
  'table.borderColor': 'Border color',
  'table.dividerColor': 'Divider color',
  'table.headerText': 'Header text',
  'table.bodyText': 'Body text',
};

const PAINT_KEYS: readonly TablePaintKey[] = TABLE_PAINT_BINDING_KEYS;

function appearanceColor(
  table: TableModel,
  key: TablePaintKey,
): import('@varve/scene').ManagedColor {
  const paint = key.slice('table.'.length) as
    | 'headerFill'
    | 'bodyFill'
    | 'alternateFill'
    | 'borderColor'
    | 'dividerColor'
    | 'headerText'
    | 'bodyText';
  return table.appearance[paint];
}

export function TableAppearanceSection({ tableId, table, onSetAppearance, onSetBinding }: Props) {
  const editor = useEditor();
  const store = docVariableStore(editor.state.document);
  const bindings =
    editor.state.selection.length === 1
      ? (
          editor.state.document.nodes[editor.state.selection[0]!] as
            | import('@varve/scene').TableNode
            | undefined
        )?.bindings
      : undefined;
  const [bindingField, setBindingField] = useState<TablePaintKey | null>(null);
  const [modifierState, setModifierState] = useState<ModifierState | null>(null);
  const bindingTriggerRef = useRef<HTMLButtonElement | null>(null);

  const activeBinding = (key: TablePaintKey): PropertyBinding | undefined =>
    bindings?.[key] as PropertyBinding | undefined;

  return (
    <div className="insp-field" style={{ gap: 6 }}>
      <div className="insp-field__label insp-field__label--wrap">Appearance variables</div>
      <div
        className="insp-field__control"
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        {PAINT_KEYS.map((key) => {
          const color = appearanceColor(table, key);
          const binding = activeBinding(key);
          const variableName = binding
            ? (store.variables[binding.variableId]?.name ?? binding.variableId)
            : null;
          const modifierLabel = binding?.modifiers?.[0]
            ? alphaModifierLabel(binding.modifiers[0])
            : null;
          const bindingValid = binding
            ? resolveBoundTokenColor(store, binding) !== undefined
            : true;

          return (
            <div key={key} className="insp-field-row__split" style={{ alignItems: 'center' }}>
              <InspectorColorPopover
                label={PAINT_LABELS[key]}
                value={color}
                onChange={(c) =>
                  onSetAppearance((t) => {
                    const paint = key.slice('table.'.length) as keyof typeof t.appearance;
                    return { ...t, appearance: { ...t.appearance, [paint]: c } };
                  })
                }
                documentColorMode={editor.documentColorMode}
              />
              {!binding && (
                <button
                  type="button"
                  ref={key === bindingField ? bindingTriggerRef : undefined}
                  className="insp-inline-btn"
                  aria-label={`Link ${PAINT_LABELS[key]} to a variable`}
                  title="Link to a variable"
                  onClick={() => setBindingField(key)}
                >
                  <Icon name="Link" label={undefined} size="0.9em" />
                </button>
              )}
              {binding && (
                <button
                  type="button"
                  ref={key === bindingField ? bindingTriggerRef : undefined}
                  className="varve-binding-badge"
                  aria-label={
                    bindingValid
                      ? 'Linked to ' +
                        (variableName ?? '') +
                        (modifierLabel ? `, alpha ${modifierLabel}` : '')
                      : `Variable ${variableName ?? ''} is missing or invalid`
                  }
                  title={
                    bindingValid
                      ? 'Linked to $' +
                        (variableName ?? '') +
                        (modifierLabel ? ` · ${modifierLabel}` : '')
                      : 'Linked variable is missing or invalid — binding preserved'
                  }
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 4,
                    border:
                      '1px solid ' +
                      (bindingValid
                        ? 'var(--color-accent-primary, #39d0c6)'
                        : 'var(--color-feedback-danger, #d64545)'),
                    color: bindingValid
                      ? 'var(--color-text-primary, #292d36)'
                      : 'var(--color-feedback-danger, #d64545)',
                    background: bindingValid
                      ? 'var(--color-surface-raised, #fff)'
                      : 'rgba(214,69,69,0.08)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setModifierState({
                      tokenColor: color,
                      binding,
                      anchorRef: bindingTriggerRef,
                    });
                  }}
                >
                  <span>${variableName}</span>
                  {modifierLabel && <strong>{modifierLabel}</strong>}
                  {!bindingValid && <span>(invalid)</span>}
                </button>
              )}
            </div>
          );
        })}

        {bindingField && (
          <BindingMenu
            variableStore={store}
            targetType="color"
            targetField={bindingField}
            triggerRef={bindingTriggerRef}
            onBind={(variableId, expression) => {
              onSetBinding(bindingField, { variableId, expression });
              setBindingField(null);
              editor.announce(`Linked ${PAINT_LABELS[bindingField]} to variable`);
            }}
            onClose={() => setBindingField(null)}
          />
        )}
        {modifierState && (
          <VariableModifierPopover
            tokenColor={modifierState.tokenColor}
            modifiers={modifierState.binding.modifiers?.filter((m) => m.kind === 'alpha') ?? []}
            anchorRef={modifierState.anchorRef}
            onCommit={(modifiers) => {
              const key = bindingField ?? tableId; // bindingField may have closed
              void key;
              const binding = modifierState.binding;
              if (modifiers) {
                onSetBinding(
                  Object.keys(bindings ?? {}).find((k) => bindings?.[k] === binding) ??
                    activeBindingKey(),
                  { ...binding, modifiers },
                );
              } else {
                const { modifiers: _drop, ...rest } = binding;
                onSetBinding(activeBindingKey(), rest);
              }
              editor.announce(modifiers ? 'Alpha modifier applied' : 'Alpha modifier reset');
            }}
            onClose={() => setModifierState(null)}
          />
        )}
      </div>
    </div>
  );

  function activeBindingKey(): string {
    if (!bindings) return 'table.headerFill';
    for (const key of PAINT_KEYS) {
      if (bindings[key] === modifierState?.binding) return key;
    }
    return 'table.headerFill';
  }
}
