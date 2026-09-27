import { Button, Switch } from '@varve/ui';
import { useEditor } from '../../../context';
import { usePanelLocalState } from '../../../workspace/panelLocalState';
import { getEmailCompilation } from './emailCompilation';

export function EmailPreviewPanel() {
  const editor = useEditor();
  const selected = editor.selectedNodes();
  const node = selected.length === 1 ? selected[0] : undefined;
  const [viewport, setViewport] = usePanelLocalState<'desktop' | 'mobile'>(
    'email-preview',
    'viewport',
    'desktop',
  );
  const [showSamples, setShowSamples] = usePanelLocalState<boolean>(
    'email-preview',
    'showSamples',
    false,
  );
  const canonical = getEmailCompilation(editor.state.document, {
    allowUnprofiled: Boolean(node),
  });
  const preview = showSamples
    ? getEmailCompilation(editor.state.document, {
        allowUnprofiled: Boolean(node),
        previewVariables: true,
      })
    : canonical;

  return (
    <section className="email-preview-panel" aria-labelledby="email-preview-heading">
      <header className="email-preview-panel__header">
        <div>
          <h2 id="email-preview-heading">Email Preview</h2>
          <p>Sandboxed browser preview. This does not verify Gmail or Outlook rendering.</p>
        </div>
        <fieldset className="email-panel__button-row email-panel__viewport-controls">
          <legend className="varve-visually-hidden">Preview width</legend>
          <Button
            size="sm"
            variant={viewport === 'desktop' ? 'default' : 'secondary'}
            aria-pressed={viewport === 'desktop'}
            onClick={() => setViewport('desktop')}
          >
            Desktop
          </Button>
          <Button
            size="sm"
            variant={viewport === 'mobile' ? 'default' : 'secondary'}
            aria-pressed={viewport === 'mobile'}
            onClick={() => setViewport('mobile')}
          >
            Mobile
          </Button>
        </fieldset>
      </header>
      <Switch
        className="email-panel__toggle"
        label="Preview sample values"
        checked={showSamples}
        onChange={(event) => setShowSamples(event.target.checked)}
      />
      {preview ? (
        <div className={`email-panel__preview-frame email-panel__preview-frame--${viewport}`}>
          <iframe
            title="Email browser preview"
            sandbox=""
            srcDoc={preview.output.html}
            className="email-panel__preview"
          />
        </div>
      ) : (
        <p className="email-preview-panel__empty">
          Enable the email template from the Email authoring tab to generate a preview.
        </p>
      )}
    </section>
  );
}
