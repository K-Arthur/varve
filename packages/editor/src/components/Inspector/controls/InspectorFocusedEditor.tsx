/**
 * InspectorFocusedEditor — an anchored, focused editor for dense property
 * details such as effect parameters. The owning row stays in the inspector;
 * the editor is portaled beside it so the rail remains scannable.
 */
import { FloatingPortal, FocusTrap } from '@varve/ui';
import type { ReactNode, RefObject } from 'react';

/**
 * Stable array identity: an inline literal would change on every parent
 * render and restart the portal's placement effect, resetting the surface to
 * `visibility: hidden` for a frame (observed as a flapping/hidden popover on
 * every document edit while the editor is open).
 */
const FALLBACK_PLACEMENTS: Array<'right-start' | 'left-end' | 'right-end'> = [
  'right-start',
  'left-end',
  'right-end',
];

export interface InspectorFocusedEditorProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  title: string;
  /** Short stage/context tag rendered in the header beside the title. */
  badge?: string;
  onClose: () => void;
  ownerKey: string;
  children: ReactNode;
}

export function InspectorFocusedEditor({
  anchorRef,
  open,
  title,
  badge,
  onClose,
  ownerKey,
  children,
}: InspectorFocusedEditorProps) {
  if (!open) return null;

  return (
    <FloatingPortal
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      placement="left-start"
      fallbackPlacements={FALLBACK_PLACEMENTS}
      maxHeight={560}
      kind="dialog"
      dismissOnEscape
      className="insp-focused-editor__portal"
    >
      <FocusTrap active={open} onClose={onClose}>
        <section
          key={ownerKey}
          className="insp-focused-editor"
          role="dialog"
          aria-modal="false"
          aria-label={title}
          data-inspector-focused-editor={ownerKey}
        >
          <header className="insp-focused-editor__header">
            <h2 className="insp-focused-editor__title">{title}</h2>
            {badge && <span className="insp-focused-editor__stage-badge">{badge}</span>}
            <button type="button" className="insp-focused-editor__close" onClick={onClose}>
              Close
            </button>
          </header>
          <div className="insp-focused-editor__body">{children}</div>
        </section>
      </FocusTrap>
    </FloatingPortal>
  );
}
