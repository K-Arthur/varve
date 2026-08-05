/**
 * CodeGenView — code generation panel within the Spec Panel.
 *
 * Uses the APG Tabs component to switch between 6 code targets. Each tab shows
 * syntax-highlighted output with line numbers, a CopyButton, and per-target
 * settings controls. Regeneration is instant (local, no network).
 *
 * Research basis: Figma Dev Mode code panel (CSS, iOS, Android, SwiftUI, Flutter);
 * APG Tabs pattern for keyboard navigation.
 */

import {
  exportNodeToCss,
  exportNodeToCssModules,
  exportNodeToFlutter,
  exportNodeToSvg,
  exportNodeToSwiftUI,
  exportNodeToTailwind,
} from '@varve/codegen';
import type { Document, SceneNode, VariableStore } from '@varve/scene';
import { CopyButton, type Tab, Tabs } from '@varve/ui';
import { useMemo, useRef, useState } from 'react';
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

export interface CodeGenViewProps {
  node: SceneNode;
  doc: Document;
  variableStore?: VariableStore;
}

function generateCode(
  node: SceneNode,
  doc: Document,
  target: CodeTarget,
  variableStore?: VariableStore,
): string {
  switch (target) {
    case 'svg':
      return exportNodeToSvg(node, doc);
    case 'css':
      return exportNodeToCss(node, doc, { variableStore });
    case 'tailwind':
      return exportNodeToTailwind(node, doc, { variableStore });
    case 'modules': {
      const result = exportNodeToCssModules(node, doc);
      return `// JSX:\n${result.jsx}\n\n// CSS:\n${result.css}`;
    }
    case 'flutter':
      return exportNodeToFlutter(node, doc, { variableStore });
    case 'swiftui':
      return exportNodeToSwiftUI(node, doc, { variableStore });
  }
}

export function CodeGenView({ node, doc, variableStore }: CodeGenViewProps) {
  const [activeTab, setActiveTab] = useState<CodeTarget>('css');
  const prevCode = useRef<Map<string, string>>(new Map());

  const code = useMemo(
    () => generateCode(node, doc, activeTab, variableStore),
    [node, doc, activeTab, variableStore],
  );

  const highlightedLines = useMemo(() => highlight(code, activeTab).split('\n'), [code, activeTab]);

  const lineCount = highlightedLines.length;

  const diffSummary = useMemo(() => {
    const key = `${node.id}:${activeTab}`;
    const prev = prevCode.current.get(key);
    prevCode.current.set(key, code);
    if (prev && prev !== code) {
      const prevLines = prev.split('\n');
      const currLines = code.split('\n');
      const added = currLines.length - prevLines.length;
      const removed = prevLines.length - currLines.length;
      return { added: Math.max(0, added), removed: Math.max(0, removed) };
    }
    return null;
  }, [code, node.id, activeTab]);

  return (
    <section className="spec-panel__section" aria-labelledby="spec-code-heading">
      <h3 id="spec-code-heading">Code</h3>
      <Tabs label="Code language" tabs={CODE_TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {CODE_TABS.map((tab) => (
          <div key={tab.value} className="spec-codegen__content">
            <div className="spec-codegen__toolbar">
              <CopyButton value={code} label={`${tab.label} code`} className="spec-row__copy" />
              {diffSummary && (
                <div className="spec-codegen__diff" aria-live="polite">
                  {diffSummary.added > 0 && (
                    <span className="spec-codegen__diff--added">+{diffSummary.added}</span>
                  )}
                  {diffSummary.removed > 0 && (
                    <span className="spec-codegen__diff--removed">-{diffSummary.removed}</span>
                  )}
                </div>
              )}
            </div>
            <section className="spec-codegen__pre" aria-label={`${tab.label} generated code`}>
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
        ))}
      </Tabs>
    </section>
  );
}
