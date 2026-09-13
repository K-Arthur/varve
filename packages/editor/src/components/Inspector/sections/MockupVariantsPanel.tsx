/**
 * Compact variant export form for a selected mockup frame. The plan is
 * explicit (template checkboxes × one frame), runs sequentially with
 * progress and cancellation, and reports per-variant failures. Nothing is
 * added to the document or its history.
 */

import type { NodeId } from '@varve/scene';
import { Button } from '@varve/ui';
import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { templatesForDocument } from '../../../mockup/mockupActions';
import { exportMockupVariants, type MockupVariantResult } from '../../../mockup/mockupVariants';

export function MockupVariantsPanel({
  frameId,
  onClose,
}: {
  frameId: NodeId;
  onClose: () => void;
}): React.ReactElement {
  const editor = useEditor();
  const templates = useMemo(
    () => templatesForDocument(editor.state.document),
    [editor.state.document],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [scale, setScale] = useState('1');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [results, setResults] = useState<MockupVariantResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const toggle = (templateId: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  };

  const run = async (): Promise<void> => {
    if (selected.size === 0 || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults([]);
    try {
      const parsedScale = Number(scale);
      const output = await exportMockupVariants(
        editor,
        {
          frameId,
          templateIds: [...selected],
          scale: Number.isFinite(parsedScale) && parsedScale > 0 ? parsedScale : 1,
        },
        (update) => setProgress({ completed: update.completed, total: update.total }),
        controller.signal,
      );
      setResults(output);
    } finally {
      setProgress(null);
      setRunning(false);
      abortRef.current = null;
    }
  };

  const succeeded = results.filter((result) => result.status === 'success').length;
  const failed = results.filter((result) => result.status === 'failed').length;

  return (
    <fieldset className="mockups-section__picker" aria-label="Export mockup variants">
      <legend className="visually-hidden">Export mockup variants</legend>
      <p className="mockups-section__picker-plan">
        One PNG per selected template, rendered from the current document revision at the chosen
        scale. Files download with unique names; the document is not changed.
      </p>
      <ul className="mockups-section__picker-list">
        {templates.map((template) => (
          <li key={template.id}>
            <label className="mockups-section__variant-row">
              <input
                type="checkbox"
                checked={selected.has(template.id)}
                disabled={running}
                onChange={() => toggle(template.id)}
              />
              <span>{template.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mockups-section__inline">
        <label className="mockups-section__number">
          <span>Scale</span>
          <input
            type="number"
            min="0.05"
            max="16"
            step="0.25"
            aria-label="Variant export scale"
            value={scale}
            disabled={running}
            onChange={(event) => setScale(event.target.value)}
          />
        </label>
      </div>
      {progress && (
        <p role="status" className="mockups-section__picker-plan">
          Exporting {progress.completed} of {progress.total}…
        </p>
      )}
      {results.length > 0 && (
        <div role="status" aria-live="polite">
          <p className="mockups-section__picker-plan">
            {succeeded} exported{failed > 0 ? `, ${failed} failed` : ''}.
          </p>
          {failed > 0 && (
            <ul className="mockups-section__picker-list">
              {results
                .filter((result) => result.status !== 'success')
                .map((result) => (
                  <li key={`${result.templateId}-${result.fileName}`}>
                    {result.fileName || result.templateId}: {result.error ?? result.status}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      <div className="mockups-section__picker-actions">
        <Button size="sm" disabled={running || selected.size === 0} onClick={() => void run()}>
          Export {selected.size > 0 ? `${selected.size} ` : ''}variant
          {selected.size === 1 ? '' : 's'}
        </Button>
        {running && (
          <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={running} onClick={onClose}>
          Close
        </Button>
      </div>
    </fieldset>
  );
}
