import type { EmailIrAsset } from '@varve/codegen';
import { Button, CopyButton } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { createBufferedExportArchive, saveExportBytes } from '../../../exportSaveAdapter';
import { EmailCodeEditor } from './EmailCodeEditor';
import { EmailPreflightPanel } from './EmailPreflightPanel';
import { EmailSourceBlocks } from './EmailSourceBlocks';
import { getEmailCompilation } from './emailCompilation';

export function EmailOutputPanel() {
  const editor = useEditor();
  const { state } = editor;
  const selected = editor.selectedNodes();
  const node = selected.length === 1 ? selected[0] : undefined;
  const compilation = getEmailCompilation(state.document, { allowUnprofiled: Boolean(node) });
  const output = compilation?.output;
  const warnings = output?.warnings ?? [];
  const selectedSourceMap =
    node && output ? output.sourceMap.find((entry) => entry.sourceNodeId === node.id) : undefined;
  const hasErrors = Boolean(
    compilation?.ir.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
      warnings.some((warning) => warning.severity === 'error'),
  );
  const diagnostics = useMemo(
    () => [
      ...(compilation?.ir.diagnostics ?? []),
      ...warnings.map((warning) => ({
        severity: warning.severity,
        code: warning.code,
        message: warning.message,
        sourceNodeId: warning.sourceNodeId,
        category: warning.category,
        suggestedFix: warning.suggestedFix,
      })),
    ],
    [compilation, warnings],
  );
  const documentNodeIds = useMemo(
    () => new Set(Object.keys(state.document.nodes)),
    [state.document.nodes],
  );

  const exportEmail = async () => {
    if (!compilation || hasErrors || !output) return;
    const baseName = safeBaseName(state.document.name);
    const encoder = new TextEncoder();
    await saveExportBytes(
      editor.platform,
      `${baseName}.html`,
      encoder.encode(output.html),
      'text/html',
      '.html',
    );
    await saveExportBytes(
      editor.platform,
      `${baseName}.txt`,
      encoder.encode(output.plainText),
      'text/plain',
      '.txt',
    );
    await saveExportBytes(
      editor.platform,
      `${baseName}.manifest.json`,
      encoder.encode(
        JSON.stringify(
          {
            format: 'varve-email-export',
            version: 1,
            provider: compilation.ir.settings.provider,
            compatibilityProfile: compilation.ir.settings.compatibilityProfile,
            assets: exportAssetManifest(compilation.ir.assets),
            diagnostics: compilation.ir.diagnostics,
          },
          null,
          2,
        ),
      ),
      'application/json',
      '.json',
    );
    for (const asset of compilation.ir.assets) {
      if (!asset.dataUrl) continue;
      const bytes = decodeDataUrl(asset.dataUrl);
      if (!bytes) continue;
      await saveExportBytes(
        editor.platform,
        `assets/${asset.filename}`,
        bytes,
        asset.mimeType,
        `.${asset.filename.split('.').pop() ?? 'bin'}`,
      );
    }
  };

  const exportEmailPackage = async () => {
    if (!compilation || hasErrors || !output) return;
    const archive = createBufferedExportArchive(editor.platform);
    const encoder = new TextEncoder();
    await archive.saveFile('email.html', encoder.encode(output.html));
    await archive.saveFile('email.txt', encoder.encode(output.plainText));
    await archive.saveFile(
      'manifest.json',
      encoder.encode(
        JSON.stringify(
          {
            format: 'varve-email-package',
            version: 1,
            provider: compilation.ir.settings.provider,
            compatibilityProfile: compilation.ir.settings.compatibilityProfile,
            assets: exportAssetManifest(compilation.ir.assets),
            diagnostics: compilation.ir.diagnostics,
          },
          null,
          2,
        ),
      ),
    );
    for (const asset of compilation.ir.assets) {
      if (!asset.dataUrl) continue;
      const bytes = decodeDataUrl(asset.dataUrl);
      if (bytes) await archive.saveFile(`assets/${asset.filename}`, bytes);
    }
    await archive.flush(safeBaseName(state.document.name));
  };

  return (
    <section
      className="email-panel__group email-output-panel"
      aria-labelledby="email-output-heading"
      data-panel="emailOutput"
      data-testid="email-output-panel"
    >
      <div className="email-panel__heading-row">
        <div>
          <h3 id="email-output-heading">Email Output</h3>
          <p className="email-panel__ownership-note">
            Generated HTML is read-only. Edit Custom HTML/CSS in Email authoring or edit a saved
            authored source block below.
          </p>
        </div>
        {output && <CopyButton value={output.html} label="Copy generated email HTML" />}
      </div>
      {output ? (
        <>
          <section aria-label="Generated email HTML (read-only)">
            <EmailCodeEditor
              label="Generated email HTML"
              language="markup"
              value={output.html}
              readOnly
              minRows={14}
              sourceRange={selectedSourceMap}
            />
            {selectedSourceMap && (
              <p className="email-panel__ownership-note">
                Selected node maps to generated HTML lines {selectedSourceMap.startLine}–
                {selectedSourceMap.endLine}.
              </p>
            )}
          </section>
          <section aria-label="Generated email plain text">
            <h4>Plain text</h4>
            <pre className="email-panel__plain-text-preview">
              <code>{output.plainText}</code>
            </pre>
          </section>
          <EmailSourceBlocks />
          <EmailPreflightPanel
            diagnostics={diagnostics}
            resolvableNodeIds={documentNodeIds}
            onSelectNode={(nodeId) => {
              editor.setSelection(nodeId);
              editor.revealSelection({ nodeId });
            }}
          />
          <div className="email-panel__button-row">
            <Button size="sm" onClick={() => void exportEmail()} disabled={hasErrors}>
              Export HTML, text, and manifest
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void exportEmailPackage()}
              disabled={hasErrors}
            >
              Export package (.zip)
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="insp-panel__empty-hint">
            Enable an email template in Email authoring to generate HTML and plain text.
          </p>
          <EmailSourceBlocks />
        </>
      )}
    </section>
  );
}

function safeBaseName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'email-template';
}

function decodeDataUrl(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).includes(';base64')) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function exportAssetManifest(assets: EmailIrAsset[]) {
  return assets.map((asset) => {
    const { dataUrl, ...metadata } = asset;
    return { ...metadata, ...(dataUrl ? { packagePath: `assets/${asset.filename}` } : {}) };
  });
}
