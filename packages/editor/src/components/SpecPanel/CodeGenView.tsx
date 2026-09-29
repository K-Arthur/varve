/**
 * CodeGenView — code generation panel within the Spec Panel.
 *
 * Uses the APG Tabs component to switch between 6 code targets. Each tab shows
 * syntax-highlighted output with line numbers, a CopyButton, and per-target
 * settings controls. Regeneration is instant (local, no network).
 *
 * A target that produces several files (React + CSS Modules is a component
 * plus its stylesheet) shows a second tab strip for the files and copies only
 * the file the user is looking at — never a concatenation of several
 * languages presented as one runnable file.
 *
 * Research basis: Figma Dev Mode code panel (CSS, iOS, Android, SwiftUI,
 * Flutter); APG Tabs pattern for keyboard navigation; Tailwind source-scanning
 * docs; css-modules/css-modules file layout.
 */

import {
  type BundleDiagnostic,
  exportNodeToCss,
  exportNodeToCssModulesBundle,
  exportNodeToFlutter,
  exportNodeToSvg,
  exportNodeToSwiftUI,
  exportNodeToTailwindBundle,
  type GeneratedFile,
  type GeneratedFileLanguage,
  toFileStem,
} from '@varve/codegen';
import type { Document, SceneNode, VariableStore } from '@varve/scene';
import { CopyButton, type Tab, Tabs } from '@varve/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeLineDiff } from './codeDiff';
import { highlight } from './syntax';

type CodeTarget = 'svg' | 'css' | 'tailwind' | 'modules' | 'flutter' | 'swiftui';

const CODE_TABS: readonly Tab<CodeTarget>[] = [
  { value: 'svg', label: 'SVG' },
  { value: 'css', label: 'CSS' },
  { value: 'tailwind', label: 'Tailwind' },
  { value: 'modules', label: 'Modules' },
  { value: 'flutter', label: 'Flutter' },
  { value: 'swiftui', label: 'SwiftUI' },
] as const;

/** What the user is actually looking at, stated plainly. */
type DeliverableKind = 'asset' | 'snippet' | 'component';

interface TargetOutput {
  deliverable: DeliverableKind;
  files: GeneratedFile[];
  diagnostics: BundleDiagnostic[];
  /** One line explaining the deliverable and its limits. */
  note: string;
}

export interface CodeGenViewProps {
  node: SceneNode;
  doc: Document;
  variableStore?: VariableStore;
}

const FILE_LANGUAGE: Record<GeneratedFileLanguage, string> = {
  tsx: 'tsx',
  ts: 'tsx',
  jsx: 'jsx',
  js: 'jsx',
  css: 'css',
  html: 'html',
  svg: 'svg',
  json: 'json',
  dart: 'dart',
  swift: 'swift',
  vue: 'html',
  svelte: 'html',
  text: 'text',
};

function singleFile(
  node: SceneNode,
  contents: string,
  language: GeneratedFileLanguage,
  mimeType: string,
  extension: string,
): GeneratedFile {
  return {
    path: `${toFileStem(node.name)}${extension}`,
    language,
    mimeType,
    contents,
    entry: true,
  };
}

function generateOutput(
  node: SceneNode,
  doc: Document,
  target: CodeTarget,
  variableStore?: VariableStore,
): TargetOutput {
  switch (target) {
    case 'svg':
      return {
        deliverable: 'asset',
        files: [singleFile(node, exportNodeToSvg(node, doc), 'svg', 'image/svg+xml', '.svg')],
        diagnostics: [],
        note: 'A standalone SVG document of the selected subtree. Open it in a browser or import it into a design tool.',
      };
    case 'css':
      return {
        deliverable: 'snippet',
        files: [
          singleFile(
            node,
            exportNodeToCss(node, doc, { variableStore }),
            'css',
            'text/css',
            '.css',
          ),
        ],
        diagnostics: [],
        note: 'One rule per layer in the selection, absolutely positioned. This is a stylesheet fragment — it needs HTML markup to render.',
      };
    case 'tailwind': {
      const bundle = exportNodeToTailwindBundle(node, doc, { variableStore });
      return {
        deliverable: bundle.deliverable === 'component' ? 'component' : 'snippet',
        files: bundle.files,
        diagnostics: bundle.diagnostics,
        note: `A React component using Tailwind utilities. ${bundle.setup?.[1] ?? ''}`.trim(),
      };
    }
    case 'modules': {
      const bundle = exportNodeToCssModulesBundle(node, doc, { variableStore });
      return {
        deliverable: 'component',
        files: bundle.files,
        diagnostics: bundle.diagnostics,
        note: 'A React component and its CSS Module. Both files are required; copying only the component will not render.',
      };
    }
    case 'flutter':
      return {
        deliverable: 'snippet',
        files: [
          singleFile(
            node,
            exportNodeToFlutter(node, doc, { variableStore }),
            'dart',
            'text/x-dart',
            '.dart',
          ),
        ],
        diagnostics: [],
        note: 'A Flutter widget expression. Paste it into a widget tree — it is not a runnable app.',
      };
    case 'swiftui':
      return {
        deliverable: 'snippet',
        files: [
          singleFile(
            node,
            exportNodeToSwiftUI(node, doc, { variableStore }),
            'swift',
            'text/x-swift',
            '.swift',
          ),
        ],
        diagnostics: [],
        note: 'A SwiftUI view expression. Paste it into a View body — it is not a runnable app.',
      };
  }
}

export function CodeGenView({ node, doc, variableStore }: CodeGenViewProps) {
  const [activeTab, setActiveTab] = useState<CodeTarget>('css');
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const output = useMemo(
    () => generateOutput(node, doc, activeTab, variableStore),
    [node, doc, activeTab, variableStore],
  );

  const files = output.files;
  const selectedFile =
    files.find((file) => file.path === activeFile) ?? files.find((file) => file.entry) ?? files[0]!;
  const code = selectedFile.contents;
  const language = FILE_LANGUAGE[selectedFile.language];

  const highlightedLines = useMemo(() => highlight(code, language).split('\n'), [code, language]);
  const lineCount = highlightedLines.length;

  // Change summary against the previous generation of the *same* file.
  // Computed in an effect: writing tracking state during render breaks
  // concurrent/strict rendering and produced a summary that reflected the
  // previous render's bookkeeping rather than a real line diff.
  const previousRef = useRef<Map<string, string>>(new Map());
  const [changeSummary, setChangeSummary] = useState<{
    added: number;
    removed: number;
  } | null>(null);
  const identity = `${node.id}:${activeTab}:${selectedFile.path}`;

  useEffect(() => {
    const previous = previousRef.current.get(identity);
    previousRef.current.set(identity, code);
    if (previous !== undefined && previous !== code) {
      setChangeSummary(computeLineDiff(previous, code));
    } else {
      setChangeSummary(null);
    }
  }, [identity, code]);

  const fileTabs: readonly Tab<string>[] = files.map((file) => ({
    value: file.path,
    label: file.path,
  }));

  return (
    <section className="spec-panel__section" aria-labelledby="spec-code-heading">
      <h3 id="spec-code-heading">Code</h3>
      <Tabs
        label="Code language"
        tabs={CODE_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        variant="compact"
        renderPanel={() => (
          <div className="spec-codegen__content">
            <p className="spec-codegen__deliverable">
              <span className={`spec-codegen__badge spec-codegen__badge--${output.deliverable}`}>
                {output.deliverable}
              </span>
              {output.note}
            </p>

            {files.length > 1 && (
              <Tabs
                label="Generated files"
                tabs={fileTabs}
                activeTab={selectedFile.path}
                onTabChange={setActiveFile}
                variant="compact"
                renderPanel={() => null}
              />
            )}

            <div className="spec-codegen__toolbar">
              <CopyButton
                value={code}
                label={`${selectedFile.path} contents`}
                className="spec-row__copy"
              />
              {changeSummary && (
                <div className="spec-codegen__diff" aria-live="polite">
                  {changeSummary.added > 0 && (
                    <span className="spec-codegen__diff--added">+{changeSummary.added}</span>
                  )}
                  {changeSummary.removed > 0 && (
                    <span className="spec-codegen__diff--removed">-{changeSummary.removed}</span>
                  )}
                </div>
              )}
            </div>

            {output.diagnostics.length > 0 && (
              <ul className="spec-codegen__diagnostics" aria-label="Conversion warnings">
                {output.diagnostics.map((diagnostic, index) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: diagnostics have no stable id and no internal state
                    key={index}
                    className={`spec-codegen__diagnostic spec-codegen__diagnostic--${diagnostic.severity}`}
                  >
                    {diagnostic.nodeName ? `${diagnostic.nodeName}: ` : ''}
                    {diagnostic.message}
                  </li>
                ))}
              </ul>
            )}

            <section
              className="spec-codegen__pre"
              aria-label={`${selectedFile.path} generated code`}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-scrollable code region (WCAG 2.1.1); the CSS already carries a focus-visible ring for this tab stop
              tabIndex={0}
            >
              <pre>
                <code>
                  {highlightedLines.map((html, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: line-numbered code; position in the rendered block is the identity (index = line number)
                    <span key={i} className="spec-codegen__line">
                      <span className="spec-codegen__line-num">
                        {String(i + 1).padStart(String(lineCount).length, ' ')}
                      </span>
                      <span
                        className="spec-codegen__line-text"
                        dangerouslySetInnerHTML={{ __html: html || ' ' }}
                      />
                    </span>
                  ))}
                </code>
              </pre>
            </section>
          </div>
        )}
      />
    </section>
  );
}
