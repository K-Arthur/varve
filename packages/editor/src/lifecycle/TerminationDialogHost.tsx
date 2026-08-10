/**
 * TerminationDialogHost — renders the coordinator's prompt requests using
 * Varve's shared Dialog primitives (native <dialog>: top-layer, focus trap,
 * Escape → cancel). Three surfaces:
 *
 *  - 'unsaved' single document: Save / Don't Save / Cancel
 *  - 'unsaved' multiple documents: checklist + Save Selected / Discard All
 *  - 'save-failed': per-document Try Again / Save As / Discard + Cancel
 *
 * Accessibility: descriptive title + message, dirty filenames identified,
 * safe action (Save) gets default focus, Escape cancels, never colour-only
 * affordances, long names truncate with the full name in the title tooltip.
 */

import { Button, Dialog } from '@varve/ui';
import { useState } from 'react';
import './termination-dialog.css';
import type { DialogOutcome, FailureChoice, PromptRequest, UnsavedChoice } from './types';

const INTENT_TITLES: Record<PromptRequest['intent'], string> = {
  'close-document': 'Close document',
  'close-window': 'Close window',
  'quit-application': 'Quit Varve',
  reload: 'Reload',
  restart: 'Restart Varve',
};

const NAME_TRUNCATE_AT = 48;

function truncate(name: string): string {
  return name.length > NAME_TRUNCATE_AT ? `${name.slice(0, NAME_TRUNCATE_AT - 3)}\u2026` : name;
}

export function TerminationDialogHost({
  request,
  onResponded,
}: {
  request: PromptRequest;
  onResponded: (request: PromptRequest) => void;
}) {
  const { kind } = request;
  if (kind === 'save-failed') {
    return <SaveFailedDialog request={request} onResponded={onResponded} />;
  }
  return <UnsavedDialog request={request} onResponded={onResponded} />;
}

function respondAndClose(
  request: PromptRequest,
  onResponded: (request: PromptRequest) => void,
  outcome: DialogOutcome | null,
): void {
  request.respond(outcome);
  onResponded(request);
}

function UnsavedDialog({
  request,
  onResponded,
}: {
  request: PromptRequest;
  onResponded: (request: PromptRequest) => void;
}) {
  const { docs, intent } = request;
  const single = docs.length === 1;
  const [checked, setChecked] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(docs.map((d) => [d.sessionId, true] as const)),
  );
  const selectedCount = docs.filter((d) => checked.get(d.sessionId)).length;

  const proceed = (choice: UnsavedChoice, ids: string[]) => {
    respondAndClose(request, onResponded, {
      kind: 'proceed',
      choices: ids.map((sessionId) => ({ sessionId, choice })),
    });
  };

  const title = single ? INTENT_TITLES[intent] : `${INTENT_TITLES[intent]}\u2026`;

  return (
    <Dialog
      open
      onClose={() => respondAndClose(request, onResponded, null)}
      dismissible={false}
      title={title}
      footer={
        <div className="varve-dialog__actions">
          <Button variant="ghost" onClick={() => respondAndClose(request, onResponded, null)}>
            Cancel
          </Button>
          {!single && (
            <Button
              variant="ghost"
              onClick={() =>
                proceed(
                  'discard',
                  docs.map((d) => d.sessionId),
                )
              }
            >
              Discard All
            </Button>
          )}
          {single && (
            <Button variant="ghost" onClick={() => proceed('discard', [docs[0]!.sessionId])}>
              Don&apos;t Save
            </Button>
          )}
          <Button
            variant="primary"
            disabled={selectedCount === 0}
            onClick={() =>
              proceed(
                'save',
                single
                  ? [docs[0]!.sessionId]
                  : docs.filter((d) => checked.get(d.sessionId)).map((d) => d.sessionId),
              )
            }
          >
            {single
              ? 'Save'
              : selectedCount === docs.length
                ? 'Save All'
                : `Save Selected (${selectedCount})`}
          </Button>
        </div>
      }
    >
      <p className="varve-dialog__desc">
        {single ? (
          <>
            <span className="termination-dialog__name" title={docs[0]!.name}>
              {truncate(docs[0]!.name)}
            </span>{' '}
            has unsaved changes.
          </>
        ) : (
          `${docs.length} documents have unsaved changes.`
        )}
      </p>
      {single && docs[0]!.untitled && (
        <p className="varve-dialog__desc termination-dialog__hint">
          This document has never been saved — Save will ask where to put it.
        </p>
      )}
      {!single && (
        <ul className="termination-dialog__list">
          {docs.map((doc) => (
            <li key={doc.sessionId} className="termination-dialog__row">
              <label className="termination-dialog__check">
                <input
                  type="checkbox"
                  checked={checked.get(doc.sessionId) ?? false}
                  onChange={(event) => {
                    const next = new Map(checked);
                    next.set(doc.sessionId, event.currentTarget.checked);
                    setChecked(next);
                  }}
                />
                <span className="termination-dialog__name" title={doc.name}>
                  {truncate(doc.name)}
                </span>
                {doc.untitled && <span className="termination-dialog__badge">Unsaved file</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function SaveFailedDialog({
  request,
  onResponded,
}: {
  request: PromptRequest;
  onResponded: (request: PromptRequest) => void;
}) {
  const { docs } = request;
  return (
    <Dialog
      open
      onClose={() => respondAndClose(request, onResponded, null)}
      dismissible={false}
      title="Could not save"
      footer={
        <div className="varve-dialog__actions">
          <Button variant="ghost" onClick={() => respondAndClose(request, onResponded, null)}>
            Cancel Quit
          </Button>
        </div>
      }
    >
      <p className="varve-dialog__desc">
        Some documents could not be saved. Varve will not quit until each one is resolved.
      </p>
      <ul className="termination-dialog__list">
        {docs.map((doc) => (
          <li
            key={doc.sessionId}
            className="termination-dialog__row termination-dialog__row--failed"
          >
            <span className="termination-dialog__name" title={doc.name}>
              {truncate(doc.name)}
            </span>
            <div className="termination-dialog__failed-actions">
              <Button
                variant="secondary"
                onClick={() =>
                  respondAndClose(request, onResponded, {
                    kind: 'proceed',
                    choices: [{ sessionId: doc.sessionId, choice: 'retry' as FailureChoice }],
                  })
                }
              >
                Try Again
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  respondAndClose(request, onResponded, {
                    kind: 'proceed',
                    choices: [{ sessionId: doc.sessionId, choice: 'save-as' as FailureChoice }],
                  })
                }
              >
                Save As&hellip;
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  respondAndClose(request, onResponded, {
                    kind: 'proceed',
                    choices: [{ sessionId: doc.sessionId, choice: 'discard' as FailureChoice }],
                  })
                }
              >
                Discard Changes
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
