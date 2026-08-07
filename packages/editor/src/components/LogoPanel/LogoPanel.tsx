/**
 * LogoPanel — first-class visual surface for the logo-creation workflow.
 *
 * Replaces the command/menu-only discoverability of the logo system with
 * visible sections: Project (brief + status), Create (start/import/concept/
 * variant), Variants, and Validation. Every action calls the same editor
 * commands used by menus and shortcuts — no business logic is duplicated in
 * React handlers. Later milestones add Vectorize, Typography, and Export
 * sections as child components of this panel.
 *
 * Visibility is workspace-config-backed and persisted (see
 * PanelSettingsStore.logoPanelVisible) — the panel never owns its own
 * open/closed state.
 */

import type { LogoConceptStatus, LogoVariantKind } from '@varve/scene';
import { Button, EmptyState, Icon, Select, Tooltip } from '@varve/ui';
import { useMemo, useState } from 'react';
import { useEditor } from '../../context';
import { PanelDragHandle } from '../PanelDragHandle';
import { VectorizeWorkflow } from '../Vectorize/VectorizeWorkflow';
import { ExportPackageSection } from './ExportPackageSection';
import { LogoTypographySection } from './LogoTypographySection';
import './logo-panel.css';

const VARIANT_KINDS: ReadonlyArray<{ value: LogoVariantKind; label: string }> = [
  { value: 'monochrome', label: 'Monochrome' },
  { value: 'reversed', label: 'Reversed' },
  { value: 'icon', label: 'Icon-only' },
  { value: 'small', label: 'Small-size' },
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'stacked', label: 'Stacked' },
  { value: 'compact', label: 'Compact' },
  { value: 'wordmark', label: 'Wordmark-only' },
  { value: 'favicon', label: 'Favicon' },
  { value: 'app-icon', label: 'App icon' },
  { value: 'custom', label: 'Custom' },
];

const CONCEPT_STATUSES: ReadonlyArray<{ value: LogoConceptStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'pinned', label: 'Pinned' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'archived', label: 'Archived' },
];

/** Walk up the parent chain to the nearest frame ancestor (or the node itself). */
function frameAncestorId(
  doc: ReturnType<typeof useEditor>['state']['document'],
  id: string,
): string | null {
  let current: string | null = id;
  while (current) {
    const node = doc.nodes[current];
    if (!node) return null;
    if (node.kind === 'frame') return current;
    const parent = Object.values(doc.nodes).find(
      (n) => 'children' in n && n.children.includes(current as string),
    );
    current = parent ? parent.id : null;
  }
  return null;
}

/** The concept registered over the selected frame ancestor, if any. */
function activeConceptId(editor: ReturnType<typeof useEditor>): string | null {
  const { document, selection } = editor.state;
  const project = document.logoProject;
  if (!project || selection.length === 0) return null;
  const frameId = frameAncestorId(document, selection[0] ?? '');
  if (!frameId) return null;
  const concept = project.concepts.find((c) => c.artboardId === frameId);
  return concept ? concept.id : null;
}

export function LogoPanel() {
  const editor = useEditor();
  const { document: doc, selection } = editor.state;
  const project = doc.logoProject;
  const [variantKind, setVariantKind] = useState<LogoVariantKind>('monochrome');

  const activeConcept = useMemo(
    () => project?.concepts.find((c) => c.id === activeConceptId(editor)) ?? null,
    [editor, project],
  );
  const activeArtboardId = useMemo(() => {
    if (selection.length === 0) return null;
    return frameAncestorId(doc, selection[0] ?? '');
  }, [doc, selection]);
  const hasArtboardContext = activeArtboardId !== null && activeConcept !== null;

  const variantDisabledReason = hasArtboardContext
    ? undefined
    : 'Select artwork inside a concept artboard first';
  const previewDisabledReason = selection.length > 0 ? undefined : 'Select a layer first';

  return (
    <section className="logo-panel" aria-label="Logo panel">
      <PanelDragHandle
        panelTypeId="logo"
        panelInstanceId="logo-primary"
        currentWindowId="main"
        title="Logo"
      >
        <header className="logo-panel__header">
          <div className="logo-panel__title-row">
            <Icon name="Stamp" size={16} />
            <h2 className="logo-panel__title">Logo</h2>
          </div>
          {project && (
            <span className="logo-panel__status" role="status">
              {project.concepts.length} concept{project.concepts.length === 1 ? '' : 's'} ·{' '}
              {project.variants.length} variant{project.variants.length === 1 ? '' : 's'}
            </span>
          )}
        </header>
      </PanelDragHandle>

      {!project ? (
        <div className="logo-panel__empty">
          <EmptyState
            illustration={
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                <rect x="8" y="14" width="48" height="36" rx="6" stroke="currentColor" />
                <circle cx="26" cy="32" r="7" stroke="currentColor" />
                <path d="M38 25 L46 32 L38 39 Z" stroke="currentColor" />
              </svg>
            }
            headline="No logo project yet"
            description="Start a logo project to work on wordmarks, marks, and brand systems with concepts, variants, and package export."
            actions={
              <Button onClick={() => editor.newLogoProject()} aria-label="Start a logo project">
                <Icon name="Plus" size={14} />
                Start logo project
              </Button>
            }
          />
        </div>
      ) : (
        <div className="logo-panel__body">
          <details className="logo-panel__section" open>
            <summary className="logo-panel__section-heading">Project</summary>
            <div className="logo-panel__section-body">
              <label className="logo-panel__field">
                <span className="logo-panel__field-label">Brand name</span>
                <input
                  className="logo-panel__text-input"
                  type="text"
                  value={project.brief?.brandName ?? ''}
                  placeholder="Brand name"
                  onChange={(e) => editor.patchBrief({ brandName: e.target.value })}
                />
              </label>
              <div className="logo-panel__field">
                <span className="logo-panel__field-label">Active concept</span>
                <div className="logo-panel__concept-row">
                  <span className="logo-panel__concept-name">{activeConcept?.name ?? '—'}</span>
                  <Select
                    label="Concept status"
                    value={activeConcept?.status ?? 'active'}
                    onChange={(status) => {
                      if (activeConcept) {
                        editor.setConceptStatus(activeConcept.id, status as LogoConceptStatus);
                      }
                    }}
                    options={CONCEPT_STATUSES.map((s) => ({
                      value: s.value,
                      label: s.label,
                    }))}
                    disabled={!activeConcept}
                  />
                </div>
              </div>
              <label className="logo-panel__field">
                <span className="logo-panel__field-label">Notes</span>
                <textarea
                  className="logo-panel__textarea"
                  rows={3}
                  value={project.brief?.notes ?? ''}
                  placeholder="Project notes"
                  onChange={(e) => editor.patchBrief({ notes: e.target.value })}
                />
              </label>
            </div>
          </details>

          <details className="logo-panel__section" open>
            <summary className="logo-panel__section-heading">Create</summary>
            <div className="logo-panel__section-body">
              <div className="logo-panel__button-row">
                <Button size="sm" onClick={() => editor.createLogoConcept()}>
                  Add concept
                </Button>
                <Tooltip
                  label="Duplicate the active concept and its artwork"
                  disabledReason={
                    activeConcept ? undefined : 'Select artwork inside a concept artboard first'
                  }
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => editor.duplicateActiveConcept()}
                    disabled={!activeConcept}
                  >
                    Duplicate concept
                  </Button>
                </Tooltip>
              </div>
              <div className="logo-panel__field">
                <span className="logo-panel__field-label">Register variant</span>
                <div className="logo-panel__button-row">
                  <Select
                    label="Variant kind"
                    value={variantKind}
                    onChange={(value) => setVariantKind(value as LogoVariantKind)}
                    options={VARIANT_KINDS.map((k) => ({ value: k.value, label: k.label }))}
                  />
                  <Tooltip
                    label="Register the active artboard as a variant"
                    disabledReason={variantDisabledReason}
                  >
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!hasArtboardContext}
                      onClick={() => {
                        const label =
                          VARIANT_KINDS.find((k) => k.value === variantKind)?.label ?? 'Variant';
                        editor.createLogoVariant(label, variantKind);
                      }}
                    >
                      Create
                    </Button>
                  </Tooltip>
                </div>
              </div>
              <div className="logo-panel__button-row logo-panel__button-row--wrap">
                {VARIANT_KINDS.slice(0, 4).map((k) => (
                  <Tooltip
                    key={k.value}
                    label={`Create ${k.label} variant from the active artboard`}
                    disabledReason={variantDisabledReason}
                  >
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!hasArtboardContext}
                      onClick={() => editor.createLogoVariant(k.label, k.value)}
                    >
                      {k.label}
                    </Button>
                  </Tooltip>
                ))}
              </div>
            </div>
          </details>

          <details className="logo-panel__section" open>
            <summary className="logo-panel__section-heading">Vectorize</summary>
            <VectorizeWorkflow emptyStateNote="Select an image layer to vectorize it. Sketch scans, screenshots, and raster logos all work here — the result is inserted beside the source as editable paths." />
          </details>

          <details className="logo-panel__section" open>
            <summary className="logo-panel__section-heading">Typography</summary>
            {(() => {
              const selected = selection[0] ? doc.nodes[selection[0]] : undefined;
              if (selected?.kind === 'text') {
                return <LogoTypographySection node={selected} />;
              }
              return (
                <div className="logo-panel__section-body">
                  <p className="logo-panel__muted">
                    Select a text layer to refine a wordmark: kerning mode, per-glyph positioning,
                    pair spacing, and outline conversion.
                  </p>
                </div>
              );
            })()}
          </details>

          <details className="logo-panel__section" open>
            <summary className="logo-panel__section-heading">Variants</summary>
            <div className="logo-panel__section-body">
              {project.variants.length === 0 ? (
                <p className="logo-panel__muted">No variants registered yet.</p>
              ) : (
                <ul className="logo-panel__list">
                  {project.variants.map((variant) => (
                    <li key={variant.id} className="logo-panel__list-item">
                      <span className="logo-panel__list-name">{variant.name}</span>
                      <span className="logo-panel__list-kind">{variant.kind}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>

          <details className="logo-panel__section" open>
            <summary className="logo-panel__section-heading">Validation</summary>
            <div className="logo-panel__section-body">
              <Tooltip
                label="Test the active artboard at small sizes on real surfaces"
                disabledReason={previewDisabledReason}
              >
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={selection.length === 0}
                  onClick={() => editor.patch({ logoPreviewDialogOpen: true })}
                >
                  Test at small sizes…
                </Button>
              </Tooltip>
              <p className="logo-panel__muted">
                Audit findings for logo-specific issues appear in the Inspector Audit tab.
              </p>
            </div>
          </details>

          <details className="logo-panel__section" open>
            <summary className="logo-panel__section-heading">Export Package</summary>
            <ExportPackageSection />
          </details>
        </div>
      )}
    </section>
  );
}
