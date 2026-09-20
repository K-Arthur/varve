/**
 * Contextual comic-workspace suggestion.
 *
 * A workflow profile is advisory metadata, so it never switches modes on its
 * own. This surface offers the matching layout once, in the panel that is
 * already showing the document's pages, and remembers a dismissal per profile.
 */
import { Button } from '@varve/ui';
import { type ReactElement, useCallback, useState } from 'react';
import { useEditor } from '../../context';
import { getBuiltInLayoutVariant } from '../../workspace/layoutVariants';

const STORAGE_KEY = 'varve-comic-layout-suggestion';

const PROFILE_LAYOUT = {
  'comic-print': { variantId: 'builtin-comic-print', label: 'Comic (print)' },
  manga: { variantId: 'builtin-comic-print', label: 'Comic (print)' },
  'webtoon-vertical': { variantId: 'builtin-webtoon-vertical', label: 'Webtoon (vertical)' },
} as const;

function readDismissed(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

export function ComicWorkspaceSuggestion(): ReactElement | null {
  const { state, requestWorkspaceSwitch, applyWorkspaceLayout } = useEditor();
  const [dismissed, setDismissed] = useState(readDismissed);
  const profile = state.document.workflowProfile;
  const hasPages = (state.document.pages?.length ?? 0) > 0;
  const mapping = profile ? PROFILE_LAYOUT[profile] : undefined;
  const visible =
    Boolean(mapping) &&
    hasPages &&
    state.workspaceMode !== 'drawing' &&
    profile !== undefined &&
    !dismissed.includes(profile);

  const applyLayout = useCallback(() => {
    if (!mapping) return;
    const variant = getBuiltInLayoutVariant(mapping.variantId);
    if (!variant) return;
    void requestWorkspaceSwitch('drawing').then((switched) => {
      if (switched) applyWorkspaceLayout(variant);
    });
  }, [applyWorkspaceLayout, mapping, requestWorkspaceSwitch]);

  const dismiss = useCallback(() => {
    if (!profile) return;
    const next = [...dismissed, profile];
    setDismissed(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A failed dismissal is not worth interrupting editing for; the
      // suggestion may reappear next session.
    }
  }, [dismissed, profile]);

  if (!visible || !mapping) return null;

  return (
    <div className="pages-panel__comic-suggestion" role="status">
      <span>This {mapping.label} document has a matching workspace layout.</span>
      <div className="pages-panel__comic-suggestion-actions">
        <Button variant="default" size="sm" onClick={applyLayout}>
          Open in Draw with layout
        </Button>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
