import { compileEmail, type EmailHtmlExportResult, emitEmailHtml, sceneToIR } from '@varve/codegen';
import {
  DEFAULT_EMAIL_PROFILE,
  DEFAULT_EMAIL_SEMANTIC,
  type EmailLinkKind,
  type EmailProfile,
  type EmailSemanticKind,
} from '@varve/scene';
import { Button, Input, Select, TextArea } from '@varve/ui';
import { useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import { saveExportBytes } from '../../../exportSaveAdapter';

const KIND_OPTIONS = [
  'auto',
  'section',
  'row',
  'column',
  'heading',
  'paragraph',
  'text',
  'image',
  'button',
  'divider',
  'spacer',
  'footer',
  'compliance',
  'custom-html',
  'decorative',
].map((value) => ({ value, label: value.replace(/-/g, ' ') }));

const PROFILE_OPTIONS = [
  { value: 'conservative', label: 'Conservative' },
  { value: 'modern', label: 'Modern' },
  { value: 'provider-specific', label: 'Provider-specific' },
];

const PROVIDER_OPTIONS = [
  { value: 'generic', label: 'Generic HTML' },
  { value: 'mailchimp', label: 'Mailchimp-compatible' },
];

const LINK_OPTIONS = [
  { value: 'web', label: 'Web URL' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Telephone' },
  { value: 'anchor', label: 'Fragment' },
  { value: 'merge-tag', label: 'Merge tag' },
];

export function EmailPanel() {
  const editor = useEditor();
  const { state } = editor;
  const selected = editor.selectedNodes();
  const node = selected.length === 1 ? selected[0] : undefined;
  const profile = state.document.emailProfile ?? DEFAULT_EMAIL_PROFILE;
  const semantics = state.document.emailSemantics;
  const semantic = node ? (semantics?.nodes[node.id] ?? DEFAULT_EMAIL_SEMANTIC) : undefined;
  const [previewMode, setPreviewMode] = useState<'preview' | 'code'>('preview');
  const [showSamples, setShowSamples] = useState(false);

  const compilation = useMemo(() => {
    if (!state.document.emailProfile && !node) return null;
    const ir = compileEmail(state.document, sceneToIR(state.document), {
      profile: profile.compatibilityProfile,
      provider: profile.provider,
      assetBaseUrl: profile.assetBaseUrl,
      previewVariables: showSamples,
    });
    return { ir: ir.ir, output: emitEmailHtml(ir.ir) };
  }, [
    node,
    profile.assetBaseUrl,
    profile.compatibilityProfile,
    profile.provider,
    showSamples,
    state.document,
  ]);
  const output: EmailHtmlExportResult | null = compilation?.output ?? null;

  const exportEmail = async () => {
    if (
      !compilation ||
      compilation.ir.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    )
      return;
    const baseName =
      state.document.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') ||
      'email-template';
    const encoder = new TextEncoder();
    await saveExportBytes(
      editor.platform,
      `${baseName}.html`,
      encoder.encode(output?.html ?? ''),
      'text/html',
      '.html',
    );
    await saveExportBytes(
      editor.platform,
      `${baseName}.txt`,
      encoder.encode(output?.plainText ?? ''),
      'text/plain',
      '.txt',
    );
    await saveExportBytes(
      editor.platform,
      `${baseName}.manifest.json`,
      encoder.encode(
        JSON.stringify(
          { assets: compilation.ir.assets, diagnostics: compilation.ir.diagnostics },
          null,
          2,
        ),
      ),
      'application/json',
      '.json',
    );
  };

  const updateProfile = (patch: Partial<EmailProfile>) => {
    editor.updateDoc((doc) => ({
      ...doc,
      emailProfile: { ...DEFAULT_EMAIL_PROFILE, ...doc.emailProfile, ...patch },
    }));
  };

  const updateSemantic = (patch: {
    kind?: EmailSemanticKind;
    mobileBehavior?: 'stack' | 'collapse' | 'hide' | 'resize' | 'preserve';
    hideOnMobile?: boolean;
  }) => {
    if (!node) return;
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
          [node.id]: {
            ...(doc.emailSemantics?.nodes[node.id] ?? DEFAULT_EMAIL_SEMANTIC),
            ...patch,
            inferred: false,
          },
        },
      },
    }));
  };

  return (
    <div className="insp-panel insp-panel--email" data-testid="email-panel">
      <div className="insp-panel__header">
        <strong>Email template</strong>
      </div>
      <div className="insp-panel__content">
        <section className="email-panel__group" aria-labelledby="email-settings-heading">
          <h3 id="email-settings-heading">Template settings</h3>
          {!state.document.emailProfile && (
            <Button size="sm" onClick={() => updateProfile({})}>
              Enable email template
            </Button>
          )}
          <Input
            label="Subject"
            value={profile.subject ?? ''}
            onChange={(event) => updateProfile({ subject: event.target.value })}
          />
          <TextArea
            label="Preheader"
            value={profile.preheader ?? ''}
            rows={2}
            onChange={(event) => updateProfile({ preheader: event.target.value })}
          />
          <Input
            label="Content width"
            type="number"
            min={280}
            max={1000}
            value={profile.contentWidth}
            onChange={(event) => updateProfile({ contentWidth: Number(event.target.value) || 600 })}
          />
          <Input
            label="Mobile breakpoint"
            type="number"
            min={280}
            max={1200}
            value={profile.mobileBreakpoint}
            onChange={(event) =>
              updateProfile({ mobileBreakpoint: Number(event.target.value) || 480 })
            }
          />
          <Select
            label="Compatibility"
            options={PROFILE_OPTIONS}
            value={profile.compatibilityProfile}
            onChange={(value) =>
              updateProfile({ compatibilityProfile: value as EmailProfile['compatibilityProfile'] })
            }
          />
          <Select
            label="Provider"
            options={PROVIDER_OPTIONS}
            value={profile.provider}
            onChange={(value) => updateProfile({ provider: value as EmailProfile['provider'] })}
          />
          <Input
            label="Asset base URL"
            placeholder="https://cdn.example.com/email"
            value={profile.assetBaseUrl ?? ''}
            onChange={(event) => updateProfile({ assetBaseUrl: event.target.value || undefined })}
          />
          <Input
            label="Language"
            value={profile.language}
            onChange={(event) => updateProfile({ language: event.target.value || 'en' })}
          />
          <Select
            label="Direction"
            options={[
              { value: 'ltr', label: 'Left to right' },
              { value: 'rtl', label: 'Right to left' },
            ]}
            value={profile.direction}
            onChange={(value) => updateProfile({ direction: value as EmailProfile['direction'] })}
          />
          <TextArea
            label="Custom email CSS"
            hint="Validated to an email-safe property and selector subset."
            rows={4}
            value={profile.customCss ?? ''}
            onChange={(event) => updateProfile({ customCss: event.target.value || undefined })}
          />
          <TextArea
            label="Manual plain-text override"
            hint="Leave empty to generate plain text from the design."
            rows={4}
            value={profile.plainTextOverride ?? ''}
            onChange={(event) =>
              updateProfile({ plainTextOverride: event.target.value || undefined })
            }
          />
        </section>

        {node && semantic && (
          <section className="email-panel__group" aria-labelledby="email-node-heading">
            <h3 id="email-node-heading">Selected node</h3>
            <Select
              label="Semantic type"
              options={KIND_OPTIONS}
              value={semantic.kind}
              onChange={(value) => updateSemantic({ kind: value as EmailSemanticKind })}
            />
            <Select
              label="Mobile behavior"
              options={[
                { value: 'preserve', label: 'Preserve' },
                { value: 'stack', label: 'Stack' },
                { value: 'collapse', label: 'Collapse' },
                { value: 'hide', label: 'Hide' },
                { value: 'resize', label: 'Resize' },
              ]}
              value={semantic.mobileBehavior ?? 'preserve'}
              onChange={(value) =>
                updateSemantic({
                  mobileBehavior: value as 'stack' | 'collapse' | 'hide' | 'resize' | 'preserve',
                })
              }
            />
            <label className="varve-checkbox">
              <input
                type="checkbox"
                checked={semantic.hideOnMobile ?? false}
                onChange={(event) => updateSemantic({ hideOnMobile: event.target.checked })}
              />{' '}
              Hide on mobile
            </label>
            <NodeLinkEditor nodeId={node.id} />
            {node.kind === 'text' && <TextRangeLinkEditor nodeId={node.id} text={node.text} />}
            <CustomHtmlEditor nodeId={node.id} enabled={semantic.kind === 'custom-html'} />
          </section>
        )}

        <VariableEditor />

        <section className="email-panel__group" aria-labelledby="email-output-heading">
          <div className="email-panel__heading-row">
            <h3 id="email-output-heading">Browser preview</h3>
            <div>
              <Button
                size="sm"
                variant={previewMode === 'preview' ? 'primary' : 'secondary'}
                onClick={() => setPreviewMode('preview')}
              >
                Preview
              </Button>
              <Button
                size="sm"
                variant={previewMode === 'code' ? 'primary' : 'secondary'}
                onClick={() => setPreviewMode('code')}
              >
                Code
              </Button>
            </div>
          </div>
          <label className="varve-checkbox">
            <input
              type="checkbox"
              checked={showSamples}
              onChange={(event) => setShowSamples(event.target.checked)}
            />{' '}
            Preview sample values
          </label>
          {output && previewMode === 'preview' && (
            <iframe
              title="Email browser preview"
              sandbox=""
              srcDoc={output.html}
              className="email-panel__preview"
            />
          )}
          {output && previewMode === 'code' && (
            <pre className="email-panel__code">
              <code>{output.html}</code>
            </pre>
          )}
          {output && (
            <p className="email-panel__plain-text">
              <strong>Plain text:</strong> {output.plainText.slice(0, 240)}
            </p>
          )}
          {compilation && compilation.ir.diagnostics.length > 0 && (
            <ul className="email-panel__diagnostics" aria-label="Email preflight diagnostics">
              {compilation.ir.diagnostics.map((diagnostic) => (
                <li
                  key={`${diagnostic.code}-${diagnostic.sourceNodeId ?? diagnostic.sourceVariableId ?? ''}`}
                >
                  {diagnostic.severity}: {diagnostic.message}
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            onClick={() => void exportEmail()}
            disabled={
              !compilation ||
              compilation.ir.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
            }
          >
            Export HTML, text, and manifest
          </Button>
        </section>
      </div>
    </div>
  );
}

function VariableEditor() {
  const editor = useEditor();
  const variables = editor.state.document.emailSemantics?.variables ?? [];
  const [name, setName] = useState('firstName');
  const [sampleValue, setSampleValue] = useState('Avery');
  const add = () => {
    if (!name.trim() || variables.some((variable) => variable.name === name.trim())) return;
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
        variables: [
          ...(doc.emailSemantics?.variables ?? []),
          { id: `email-var-${name.trim()}`, name: name.trim(), type: 'text', sampleValue },
        ],
      },
    }));
  };
  return (
    <section className="email-panel__group" aria-labelledby="email-variables-heading">
      <h3 id="email-variables-heading">Personalization</h3>
      <Input label="Variable name" value={name} onChange={(event) => setName(event.target.value)} />
      <Input
        label="Sample value"
        value={sampleValue}
        onChange={(event) => setSampleValue(event.target.value)}
      />
      <Button size="sm" onClick={add}>
        Add variable
      </Button>
      {variables.length > 0 && (
        <ul className="email-panel__diagnostics">
          {variables.map((variable) => (
            <li key={variable.id}>
              {`{{${variable.name}}}`} = {variable.sampleValue}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NodeLinkEditor({ nodeId }: { nodeId: string }) {
  const editor = useEditor();
  const link = editor.state.document.emailSemantics?.nodeLinks?.[nodeId];
  const [url, setUrl] = useState(link?.url ?? '');
  const [kind, setKind] = useState<EmailLinkKind>(link?.kind ?? 'web');
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
        nodeLinks: { ...(doc.emailSemantics?.nodeLinks ?? {}), [nodeId]: { url, kind } },
      },
    }));
  const remove = () =>
    editor.updateDoc((doc) => {
      const nodeLinks = { ...(doc.emailSemantics?.nodeLinks ?? {}) };
      delete nodeLinks[nodeId];
      return {
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
          nodeLinks,
        },
      };
    });
  return (
    <div className="email-panel__link">
      <h4>Link</h4>
      <Select
        label="Type"
        options={LINK_OPTIONS}
        value={kind}
        onChange={(value) => setKind(value as EmailLinkKind)}
      />
      <Input
        label="Target"
        value={url}
        placeholder="https://example.com"
        onChange={(event) => setUrl(event.target.value)}
      />
      <div>
        <Button size="sm" onClick={save}>
          Save link
        </Button>
        {link && (
          <Button size="sm" variant="secondary" onClick={remove}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

function TextRangeLinkEditor({ nodeId, text }: { nodeId: string; text: string }) {
  const editor = useEditor();
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(text.length, 1));
  const [url, setUrl] = useState('');
  const save = () => {
    if (start < 0 || end <= start || end > text.length) return;
    const key = `${nodeId}:${start}:${end}`;
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
        textRangeLinks: {
          ...(doc.emailSemantics?.textRangeLinks ?? {}),
          [key]: { nodeId, startIndex: start, endIndex: end, link: { url, kind: 'web' } },
        },
      },
    }));
  };
  return (
    <div className="email-panel__link">
      <h4>Text range link</h4>
      <p className="insp-panel__empty-hint">Text length: {text.length}</p>
      <Input
        label="Start"
        type="number"
        min={0}
        value={start}
        onChange={(event) => setStart(Number(event.target.value) || 0)}
      />
      <Input
        label="End"
        type="number"
        min={1}
        value={end}
        onChange={(event) => setEnd(Number(event.target.value) || 1)}
      />
      <Input label="URL" value={url} onChange={(event) => setUrl(event.target.value)} />
      <Button size="sm" onClick={save}>
        Add range link
      </Button>
    </div>
  );
}

function CustomHtmlEditor({ nodeId, enabled }: { nodeId: string; enabled: boolean }) {
  const editor = useEditor();
  const current = editor.state.document.emailSemantics?.customHtmlBlocks?.[nodeId]?.code ?? '';
  const [code, setCode] = useState(current);
  if (!enabled) return null;
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
          [nodeId]: { code, userAuthored: true },
        },
      },
    }));
  return (
    <div className="email-panel__link">
      <h4>Custom HTML block</h4>
      <TextArea
        label="Email-safe HTML"
        rows={8}
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      <Button size="sm" onClick={save}>
        Save custom block
      </Button>
    </div>
  );
}
