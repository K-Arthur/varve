import type { EmailDiagnostic, EmailVariable } from '@varve/scene';
import { emitEmailHtml } from './email-html';
import type { EmailDocumentIr } from './email-ir-types';
import { runEmailPreflight } from './email-preflight';

export interface EmailProviderAdapter {
  id: 'generic' | 'mailchimp';
  compile(ir: EmailDocumentIr): { html: string; plainText: string; diagnostics: EmailDiagnostic[] };
  validate(ir: EmailDocumentIr): EmailDiagnostic[];
  mapVariable(variable: EmailVariable): string;
}

export const genericEmailProvider: EmailProviderAdapter = {
  id: 'generic',
  compile(ir) {
    const output = emitEmailHtml(ir);
    return {
      html: output.html,
      plainText: output.plainText,
      diagnostics: [...runEmailPreflight(ir), ...warningsToDiagnostics(output.warnings)],
    };
  },
  validate(ir) {
    const output = emitEmailHtml(ir);
    return [...runEmailPreflight(ir), ...warningsToDiagnostics(output.warnings)];
  },
  mapVariable(variable) {
    return variable.templateTag ?? `{{${variable.name}}}`;
  },
};

export const mailchimpEmailProvider: EmailProviderAdapter = {
  id: 'mailchimp',
  compile(ir) {
    const output = emitEmailHtml(ir);
    return {
      html: output.html,
      plainText: output.plainText,
      diagnostics: [...runEmailPreflight(ir), ...warningsToDiagnostics(output.warnings)],
    };
  },
  validate(ir) {
    const output = emitEmailHtml(ir);
    return [...runEmailPreflight(ir), ...warningsToDiagnostics(output.warnings)];
  },
  mapVariable(variable) {
    return variable.templateTag ?? `*|${variable.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}|*`;
  },
};

export function getEmailProviderAdapter(id: EmailProviderAdapter['id']): EmailProviderAdapter {
  return id === 'mailchimp' ? mailchimpEmailProvider : genericEmailProvider;
}

function warningsToDiagnostics(
  warnings: ReturnType<typeof emitEmailHtml>['warnings'],
): EmailDiagnostic[] {
  return warnings.map((warning) => ({
    severity: warning.severity,
    code: warning.code,
    message: warning.message,
    sourceNodeId: warning.sourceNodeId,
    category: warning.category,
    suggestedFix: warning.suggestedFix,
  }));
}
