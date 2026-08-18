import type { EmailDiagnostic, EmailVariable } from '@varve/scene';
import { emitEmailHtml } from './email-html';
import type { EmailDocumentIr } from './email-ir-types';

export interface EmailProviderAdapter {
  id: 'generic' | 'mailchimp';
  compile(ir: EmailDocumentIr): { html: string; plainText: string; diagnostics: EmailDiagnostic[] };
  mapVariable(variable: EmailVariable): string;
}

export const genericEmailProvider: EmailProviderAdapter = {
  id: 'generic',
  compile(ir) {
    const output = emitEmailHtml(ir);
    return { html: output.html, plainText: output.plainText, diagnostics: [] };
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
      diagnostics: output.warnings.map((warning) => ({
        severity: warning.severity,
        code: warning.code,
        message: warning.message,
        sourceNodeId: warning.sourceNodeId,
        category: warning.category,
        suggestedFix: warning.suggestedFix,
      })),
    };
  },
  mapVariable(variable) {
    return variable.templateTag ?? `*|${variable.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}|*`;
  },
};

export function getEmailProviderAdapter(id: EmailProviderAdapter['id']): EmailProviderAdapter {
  return id === 'mailchimp' ? mailchimpEmailProvider : genericEmailProvider;
}
