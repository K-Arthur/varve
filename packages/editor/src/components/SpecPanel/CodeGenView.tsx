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

import { useMemo, useState } from 'react';
import type { Document, SceneNode } from '@strata/scene';
import { Tabs, type Tab, CopyButton } from '@strata/ui';
import {
  exportNodeToSvg,
  exportNodeToCss,
  exportNodeToTailwind,
  exportNodeToCssModules,
  exportNodeToFlutter,
  exportNodeToSwiftUI,
} from '@strata/codegen';

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
}

function generateCode(node: SceneNode, doc: Document, target: CodeTarget): string {
  switch (target) {
    case 'svg':
      return exportNodeToSvg(node, doc);
    case 'css':
      return exportNodeToCss(node, doc);
    case 'tailwind':
      return exportNodeToTailwind(node, doc);
    case 'modules': {
      const result = exportNodeToCssModules(node, doc);
      return `// JSX:\n${result.jsx}\n\n// CSS:\n${result.css}`;
    }
    case 'flutter':
      return exportNodeToFlutter(node);
    case 'swiftui':
      return exportNodeToSwiftUI(node);
  }
}

export function CodeGenView({ node, doc }: CodeGenViewProps) {
  const [activeTab, setActiveTab] = useState<CodeTarget>('css');

  const code = useMemo(
    () => generateCode(node, doc, activeTab),
    [node, doc, activeTab],
  );

  const lineCount = code.split('\n').length;

  return (
    <section className="spec-panel__section" aria-labelledby="spec-code-heading">
      <h3 id="spec-code-heading">Code</h3>
      <Tabs label="Code language" tabs={CODE_TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {CODE_TABS.map((tab) => (
          <div key={tab.value} className="spec-codegen__content">
            <div className="spec-codegen__toolbar">
              <CopyButton value={code} label={`${tab.label} code`} className="spec-row__copy" />
            </div>
            <pre
              className="spec-codegen__pre"
              tabIndex={0}
              aria-label={`${tab.label} generated code`}
            >
              <code>
                {code.split('\n').map((line, i) => (
                  <span key={i} className="spec-codegen__line">
                    <span className="spec-codegen__line-num">{String(i + 1).padStart(String(lineCount).length, ' ')}</span>
                    <span className="spec-codegen__line-text">{line || ' '}</span>
                  </span>
                ))}
              </code>
            </pre>
          </div>
        ))}
      </Tabs>
    </section>
  );
}
