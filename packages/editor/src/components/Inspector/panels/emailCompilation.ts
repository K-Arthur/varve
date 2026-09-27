import { compileEmail, type EmailHtmlExportResult, emitEmailHtml, sceneToIR } from '@varve/codegen';
import { DEFAULT_EMAIL_PROFILE, type Document } from '@varve/scene';

export interface EmailCompilationSnapshot {
  ir: ReturnType<typeof compileEmail>['ir'];
  output: EmailHtmlExportResult;
}

export interface EmailCompilationOptions {
  /** Allow compatibility analysis while the document has no active email profile. */
  allowUnprofiled?: boolean;
  /** Substitute configured sample values for the browser preview only. */
  previewVariables?: boolean;
}

const snapshots = new WeakMap<Document, Map<string, EmailCompilationSnapshot>>();

/**
 * Share one compiler result between Email Authoring, Preview, and Output.
 * Document snapshots are immutable; WeakMap keys let obsolete revisions be
 * collected while each revision keeps generated output out of export-only UI.
 */
export function getEmailCompilation(
  document: Document,
  options: EmailCompilationOptions = {},
): EmailCompilationSnapshot | null {
  if (!document.emailProfile && !options.allowUnprofiled) return null;

  const profile = document.emailProfile ?? DEFAULT_EMAIL_PROFILE;
  const previewVariables = options.previewVariables === true;
  const cacheKey = [
    profile.compatibilityProfile,
    profile.provider,
    profile.assetBaseUrl ?? '',
    previewVariables ? 'preview' : 'canonical',
  ].join('\u001f');
  let revisionSnapshots = snapshots.get(document);
  const cached = revisionSnapshots?.get(cacheKey);
  if (cached) return cached;

  const result = compileEmail(document, sceneToIR(document), {
    profile: profile.compatibilityProfile,
    provider: profile.provider,
    assetBaseUrl: profile.assetBaseUrl,
    previewVariables,
  });
  const snapshot = { ir: result.ir, output: emitEmailHtml(result.ir) };
  if (!revisionSnapshots) {
    revisionSnapshots = new Map();
    snapshots.set(document, revisionSnapshots);
  }
  revisionSnapshots.set(cacheKey, snapshot);
  return snapshot;
}
