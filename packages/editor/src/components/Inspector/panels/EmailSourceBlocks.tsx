import { Button } from '@varve/ui';
import { useEditor } from '../../../context';
import { usePanelLocalState } from '../../../workspace/panelLocalState';
import { EmailCodeEditor } from './EmailCodeEditor';

export function EmailSourceBlocks() {
  const editor = useEditor();
  const blocks = editor.state.document.emailSemantics?.customHtmlBlocks ?? {};
  const selected = editor.selectedNodes();
  const selectedNode = selected.length === 1 ? selected[0] : undefined;

  const createForSelection = () => {
    if (!selectedNode) return;
    editor.updateDoc((doc) => ({
      ...doc,
      emailSemantics: {
        ...(doc.emailSemantics ?? {
          nodes: {},
          nodeLinks: {},
          textRangeLinks: {},
          variables: [],
          customHtmlBlocks: {},
          assets: {},
          diagnostics: [],
        }),
        nodes: {
          ...(doc.emailSemantics?.nodes ?? {}),
          [selectedNode.id]: {
            ...(doc.emailSemantics?.nodes[selectedNode.id] ?? {}),
            kind: 'custom-html',
            inferred: false,
          },
        },
        customHtmlBlocks: {
          ...(doc.emailSemantics?.customHtmlBlocks ?? {}),
          [selectedNode.id]: { code: '', userAuthored: true },
        },
      },
    }));
  };

  return (
    <section className="email-panel__group" aria-labelledby="email-source-blocks-heading">
      <h3 id="email-source-blocks-heading">Authored source blocks</h3>
      <p className="email-panel__ownership-note">
        Saved HTML is listed even when its node is hidden or produces no visible preview content.
        Source blocks stay separate from generated, read-only HTML.
      </p>
      {selectedNode && !blocks[selectedNode.id] && (
        <Button size="sm" variant="secondary" onClick={createForSelection}>
          Create source block for selected node
        </Button>
      )}
      {Object.keys(blocks).length === 0 ? (
        <p className="insp-panel__empty-hint">No authored HTML blocks yet.</p>
      ) : (
        <ul className="email-panel__source-blocks" aria-label="Saved authored source blocks">
          {Object.entries(blocks).map(([nodeId, block]) => (
            <li key={nodeId}>
              <details>
                <summary>
                  {editor.state.document.nodes[nodeId]?.name ?? `Source block · ${nodeId}`}
                </summary>
                <p className="email-panel__ownership-note">
                  {editor.state.document.nodes[nodeId]
                    ? 'The source is kept separately from generated HTML.'
                    : 'The source is preserved without a matching visible scene node.'}
                </p>
                <EmailSourceBlockEditor key={nodeId} nodeId={nodeId} initialCode={block.code} />
                {editor.state.document.nodes[nodeId] && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      editor.setSelection(nodeId);
                      editor.revealSelection({ nodeId });
                    }}
                  >
                    Select source node
                  </Button>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmailSourceBlockEditor({ nodeId, initialCode }: { nodeId: string; initialCode: string }) {
  const editor = useEditor();
  const [code, setCode] = usePanelLocalState<string>(
    'email-output',
    `authored-source:${nodeId}`,
    initialCode,
  );

  const save = () =>
    editor.updateDoc((doc) => ({
      ...doc,
      emailSemantics: {
        ...(doc.emailSemantics ?? {
          nodes: {},
          nodeLinks: {},
          textRangeLinks: {},
          variables: [],
          customHtmlBlocks: {},
          assets: {},
          diagnostics: [],
        }),
        customHtmlBlocks: {
          ...(doc.emailSemantics?.customHtmlBlocks ?? {}),
          [nodeId]: {
            ...(doc.emailSemantics?.customHtmlBlocks?.[nodeId] ?? {}),
            code,
            userAuthored: true,
          },
        },
      },
    }));

  return (
    <div className="email-panel__source-editor">
      <EmailCodeEditor
        label={`Authored HTML source for ${nodeId}`}
        language="markup"
        value={code}
        onChange={setCode}
        minRows={8}
      />
      <Button size="sm" onClick={save}>
        Save source block
      </Button>
    </div>
  );
}
