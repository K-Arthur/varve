import { appendTrackingParams, validateEmailUrl } from '@varve/codegen';
import {
  DEFAULT_EMAIL_PROFILE,
  DEFAULT_EMAIL_SEMANTIC,
  type EmailLinkKind,
  type EmailProfile,
  type EmailSemanticKind,
  type EmailTrackingParams,
} from '@varve/scene';
import { Button, CopyButton, Input, Select, Switch, TextArea } from '@varve/ui';
import { useEffect, useState } from 'react';
import { useEditor } from '../../../context';
import { EmailCodeEditor } from './EmailCodeEditor';
import { EmailNodeCompatibility } from './EmailNodeCompatibility';
import { EmailOutputPanel } from './EmailOutputPanel';
import { getEmailCompilation } from './emailCompilation';

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

export function EmailPanel({ showOutput = true }: { showOutput?: boolean }) {
  const editor = useEditor();
  const { state } = editor;
  const selected = editor.selectedNodes();
  const node = selected.length === 1 ? selected[0] : undefined;
  const profile = state.document.emailProfile ?? DEFAULT_EMAIL_PROFILE;
  const semantics = state.document.emailSemantics;
  const semantic = node ? (semantics?.nodes[node.id] ?? DEFAULT_EMAIL_SEMANTIC) : undefined;
  const compilation = getEmailCompilation(state.document, { allowUnprofiled: Boolean(node) });
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
          <EmailCodeEditor
            label="Custom email CSS"
            language="css"
            value={profile.customCss ?? ''}
            onChange={(value) => updateProfile({ customCss: value || undefined })}
            minRows={6}
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
            <Switch
              className="email-panel__toggle"
              label="Hide on mobile"
              checked={semantic.hideOnMobile ?? false}
              onChange={(event) => updateSemantic({ hideOnMobile: event.target.checked })}
            />
            <EmailNodeCompatibility ir={compilation?.ir ?? null} nodeId={node.id} />
            <NodeLinkEditor nodeId={node.id} />
            {node.kind === 'text' && <TextRangeLinkEditor nodeId={node.id} text={node.text} />}
            <CustomHtmlEditor nodeId={node.id} enabled={semantic.kind === 'custom-html'} />
          </section>
        )}

        <VariableEditor />
        {showOutput && <EmailOutputPanel />}
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
  const [tracking, setTracking] = useState<EmailTrackingParams>(link?.tracking ?? {});
  const validation = validateEmailUrl({ url, kind });
  const trackedUrl = validation.valid ? appendTrackingParams(validation.value, tracking) : '';

  useEffect(() => {
    setUrl(link?.url ?? '');
    setKind(link?.kind ?? 'web');
    setTracking(link?.tracking ?? {});
  }, [link, nodeId]);

  const updateTracking = (patch: Partial<EmailTrackingParams>) =>
    setTracking((current) => ({ ...current, ...patch }));

  const save = () => {
    if (!validation.valid) return;
    const cleanTracking = Object.fromEntries(
      Object.entries(tracking).filter(([, value]) => value?.trim()),
    ) as EmailTrackingParams;
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
        nodeLinks: {
          ...(doc.emailSemantics?.nodeLinks ?? {}),
          [nodeId]: { url, kind, tracking: cleanTracking },
        },
      },
    }));
  };
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
  const openLink = () => {
    if (trackedUrl) window.open(trackedUrl, '_blank', 'noopener,noreferrer');
  };
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
      {url.trim() && !validation.valid && (
        <p className="email-panel__link-status" role="alert">
          Invalid link: {validation.reason}
        </p>
      )}
      {validation.valid && (
        <p className="email-panel__link-status email-panel__link-status--valid" role="status">
          Valid target: {trackedUrl}
        </p>
      )}
      <details className="email-panel__tracking">
        <summary>Optional tracking parameters</summary>
        <Input
          label="Source"
          value={tracking.source ?? ''}
          onChange={(event) => updateTracking({ source: event.target.value })}
        />
        <Input
          label="Medium"
          value={tracking.medium ?? ''}
          onChange={(event) => updateTracking({ medium: event.target.value })}
        />
        <Input
          label="Campaign"
          value={tracking.campaign ?? ''}
          onChange={(event) => updateTracking({ campaign: event.target.value })}
        />
        <Input
          label="Content"
          value={tracking.content ?? ''}
          onChange={(event) => updateTracking({ content: event.target.value })}
        />
        <Input
          label="Term"
          value={tracking.term ?? ''}
          onChange={(event) => updateTracking({ term: event.target.value })}
        />
      </details>
      <div>
        <Button size="sm" onClick={save} disabled={!validation.valid}>
          Save link
        </Button>
        {trackedUrl && <CopyButton value={trackedUrl} label="Copy email link" />}
        {trackedUrl && (
          <Button size="sm" variant="secondary" onClick={openLink}>
            Test link
          </Button>
        )}
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
  const ranges = Object.entries(editor.state.document.emailSemantics?.textRangeLinks ?? {})
    .filter(([, range]) => range.nodeId === nodeId)
    .sort(
      ([, left], [, right]) => left.startIndex - right.startIndex || left.endIndex - right.endIndex,
    );
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(text.length, 1));
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<EmailLinkKind>('web');
  const validation = validateEmailUrl({ url, kind });
  const save = () => {
    if (start < 0 || end <= start || end > text.length || !validation.valid) return;
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
          [key]: { nodeId, startIndex: start, endIndex: end, link: { url, kind } },
        },
      },
    }));
  };
  const remove = (key: string) =>
    editor.updateDoc((doc) => {
      const textRangeLinks = { ...(doc.emailSemantics?.textRangeLinks ?? {}) };
      delete textRangeLinks[key];
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
          textRangeLinks,
        },
      };
    });
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
      <Select
        label="Type"
        options={LINK_OPTIONS}
        value={kind}
        onChange={(value) => setKind(value as EmailLinkKind)}
      />
      <Input label="URL" value={url} onChange={(event) => setUrl(event.target.value)} />
      {url.trim() && !validation.valid && (
        <p className="email-panel__link-status" role="alert">
          Invalid link: {validation.reason}
        </p>
      )}
      <Button
        size="sm"
        onClick={save}
        disabled={!validation.valid || end <= start || end > text.length}
      >
        Add range link
      </Button>
      {ranges.length > 0 && (
        <ul className="email-panel__text-range-links" aria-label="Text range links">
          {ranges.map(([key, range]) => (
            <li key={key}>
              <span>
                {range.startIndex}–{range.endIndex}: {range.link.url}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => remove(key)}
                aria-label={`Remove text range link ${range.startIndex}–${range.endIndex}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
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
      <h4>Custom HTML block · preserved source</h4>
      <p className="email-panel__ownership-note">
        This block is user-authored and survives design recompilation. Scripts, event handlers,
        unsafe URLs, unsupported tags, and oversized input are rejected before preview/export.
      </p>
      <EmailCodeEditor
        label="Email-safe HTML"
        language="markup"
        value={code}
        onChange={setCode}
        minRows={10}
      />
      <Button size="sm" onClick={save}>
        Save custom block
      </Button>
    </div>
  );
}
