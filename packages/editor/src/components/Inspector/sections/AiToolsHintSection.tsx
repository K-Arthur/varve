/**
 * AiToolsHintSection — compact pointer to the AI/ML image tools (background
 * removal, colorize, denoise, lens blur, line art, content-aware fill,
 * detect text, OCR, blend images, image enhancement, extract palette) that
 * live in Photo workspace mode instead of being permanently stacked in
 * Properties. Shown only for image selections while outside that mode —
 * see sectionRegistry.ts's workspaceMode gate on those section ids.
 */
import { Button } from '@strata/ui';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { useWorkspaceSwitcher } from '../../../workspace/useWorkspace';
import { WORKSPACE_LABELS, WORKSPACE_SHORTCUTS } from '../../../workspace/workspaceTypes';
import { DisclosureSection } from '../controls/DisclosureSection';

export function AiToolsHintSection() {
  const { state, setWorkspaceMode, setTool } = useEditor();
  const { switchMode } = useWorkspaceSwitcher();

  const handleSwitch = useCallback(() => {
    // useWorkspaceSwitcher expects context/types.ts's EditorContextValue shape;
    // useEditor() resolves a structurally-different same-named type, so pass
    // only the fields switchMode actually needs. setTool is required, not
    // optional: state.maskPreviewMode defaults to 'checkerboard' and is never
    // set to 'none' anywhere in context.tsx, so detectInteractionState's
    // `maskPreviewMode !== 'none'` check always reports 'mask-editing' and
    // resolveInteraction always calls ctx.setTool('select') before switching
    // — omitting it throws (see the flagged finding on the same bug affecting
    // WorkspaceSwitcher.tsx's identical minimal-context pattern).
    switchMode({ state, setWorkspaceMode, setTool } as Parameters<typeof switchMode>[0], 'image');
  }, [state, setWorkspaceMode, setTool, switchMode]);

  const label = WORKSPACE_LABELS.image;
  const shortcut = WORKSPACE_SHORTCUTS.image;

  return (
    <DisclosureSection title="AI Tools" sectionId="ai-tools-hint" defaultExpanded>
      <div className="insp-ai-hint">
        <p className="insp-panel__empty-hint insp-ai-hint__text">
          Background removal, colorize, denoise, and more live in {label} mode.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleSwitch}
          aria-label={`Switch to ${label} mode (${shortcut})`}
        >
          Switch to {label} mode
        </Button>
      </div>
    </DisclosureSection>
  );
}
