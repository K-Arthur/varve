/**
 * Email HTML Emitter — converts Email IR to email-compatible HTML.
 *
 * Produces responsive, email-client-compatible HTML with:
 * - Table-based layout for conservative profile
 * - Inline CSS for maximum compatibility
 * - Responsive media queries for mobile stacking
 * - MSO conditional comments for Outlook
 * - Image handling with proper alt text
 * - Link validation and protocol safety
 *
 * Never generates <script>, event handlers, or javascript: URLs.
 */

import type {
  EmailDocumentIr,
  EmailIrLink,
  EmailIrNode,
  EmailIrTextRun,
  EmailIrWarning,
} from './email-ir-types';
import { sanitizeEmailCss, sanitizeEmailHtml, validateEmailUrl } from './email-security';

// ── Options ───────────────────────────────────────────────────────────────────

export interface EmailHtmlExportOptions {
  /** Include MSO conditional comments for Outlook. Default true. */
  includeMsoConditionals?: boolean;

  /** Include responsive media queries. Default true. */
  includeResponsive?: boolean;

  /** Indentation string. Default '  '. */
  indent?: string;

  /** Whether to include comments in the output. Default false. */
  includeComments?: boolean;

  /** Asset base URL for resolving relative paths. */
  assetBaseUrl?: string;
}

export interface EmailHtmlExportResult {
  /** Complete HTML document. */
  html: string;

  /** CSS to embed in <style> tag. */
  css: string;

  /** Collected asset references. */
  assets: string[];

  /** Emission warnings. */
  warnings: EmailIrWarning[];

  /** Plain-text fallback generated from the same Email IR. */
  plainText: string;
}

// ── Main Emitter ──────────────────────────────────────────────────────────────

export function emitEmailHtml(
  ir: EmailDocumentIr,
  opts: EmailHtmlExportOptions = {},
): EmailHtmlExportResult {
  const indent = opts.indent ?? '  ';
  const warnings: EmailIrWarning[] = [];
  const assets: string[] = [];

  const settings = ir.settings;
  const resolvedOptions = { ...opts, assetBaseUrl: opts.assetBaseUrl ?? settings.assetBaseUrl };
  const sanitizedCss = settings.customCss
    ? sanitizeEmailCss(settings.customCss)
    : { css: '', removed: [] as string[] };
  for (const removed of sanitizedCss.removed) {
    warnings.push({
      severity: 'warning',
      code: 'UNSAFE_CUSTOM_CSS',
      message: `Removed unsafe custom CSS construct: ${removed}.`,
      category: 'security',
    });
  }

  // Emit body content
  const bodyParts: string[] = [];
  for (const node of ir.nodes) {
    const html = emitNode(node, indent, 0, resolvedOptions, warnings, assets);
    if (html) bodyParts.push(html);
  }

  // Build responsive CSS
  const responsiveCss =
    opts.includeResponsive !== false
      ? buildResponsiveCss(ir, settings.mobileBreakpoint, indent)
      : '';
  const css = [
    buildResetCss(indent),
    buildBaseCss(settings, indent),
    responsiveCss,
    sanitizedCss.css,
  ]
    .filter(Boolean)
    .join('\n');

  // Build MSO conditionals
  const msoHead =
    opts.includeMsoConditionals !== false
      ? buildMsoHead(settings.contentWidth, settings.bodyBackground)
      : '';

  // Build the full HTML document
  const html = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="${escapeHtml(settings.language)}" dir="${settings.direction}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(settings.subject ?? '')}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  ${msoHead}
  <![endif]-->
  <style type="text/css">
    ${css}
  </style>
</head>
<body style="margin: 0; padding: 0; ${settings.bodyBackground ? `background-color: ${escapeHtml(settings.bodyBackground)};` : ''} -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  ${settings.preheader ? buildPreheader(settings.preheader, indent) : ''}
  <center>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${escapeHtml(settings.bodyBackground ?? '#ffffff')};">
      <tr>
        <td align="center" valign="top" style="padding: 0;">
          <!--[if mso]>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${settings.contentWidth}" align="center">
          <tr>
          <td>
          <![endif]-->
          <div class="email-container" style="max-width: ${settings.contentWidth}px; margin: 0 auto; ${settings.contentBackground ? `background-color: ${escapeHtml(settings.contentBackground)};` : ''}">
            ${bodyParts.join(`\n${indent}`)}
          </div>
          <!--[if mso]>
          </td>
          </tr>
          </table>
          <![endif]-->
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`;

  return {
    html,
    css,
    assets: [...new Set(assets)].sort(),
    warnings,
    plainText: ir.plainText,
  };
}

// ── Node Emitter ──────────────────────────────────────────────────────────────

function emitNode(
  node: EmailIrNode,
  indent: string,
  depth: number,
  opts: EmailHtmlExportOptions,
  warnings: EmailIrWarning[],
  assets: string[],
): string {
  const pad = indent.repeat(depth);
  const innerPad = indent.repeat(depth + 1);

  // Raster fallback
  if (
    node.rasterFallback &&
    (node.compatibility === 'rasterized' || node.compatibility === 'unsupported')
  ) {
    assets.push(node.rasterFallback);
    const imgTag = `<img src="${escapeHtml(node.rasterFallback)}" alt="${escapeHtml(node.alt ?? node.name)}" width="${node.width ?? '100'}" style="display: block; max-width: 100%; ${buildInlineStyles(node.styles)}" />`;
    if (node.link) {
      const href = safeLinkOpen(node.link, warnings, node.sourceNodeId, 'raster');
      return href ? `${pad}${href}\n${innerPad}${imgTag}\n${pad}</a>` : `${pad}${imgTag}`;
    }
    return `${pad}${imgTag}`;
  }

  switch (node.kind) {
    case 'heading':
      return emitHeading(node, indent, depth, opts, warnings, assets);
    case 'paragraph':
    case 'text':
      return emitText(node, indent, depth, opts, warnings, assets);
    case 'image':
      return emitImage(node, indent, depth, opts, warnings, assets);
    case 'button':
      return emitButton(node, indent, depth, opts, warnings, assets);
    case 'divider':
      return emitDivider(node, indent, depth);
    case 'spacer':
      return emitSpacer(node, indent, depth);
    case 'custom-html':
      return emitCustomHtml(node, indent, depth, warnings);
    case 'preheader':
      return emitPreheader(node, indent, depth, warnings);
    default:
      return emitContainer(node, indent, depth, opts, warnings, assets);
  }
}

// ── Element Emitters ──────────────────────────────────────────────────────────

function emitHeading(
  node: EmailIrNode,
  indent: string,
  depth: number,
  _opts: EmailHtmlExportOptions,
  warnings: EmailIrWarning[],
  _assets: string[],
): string {
  const pad = indent.repeat(depth);
  const level = node.headingLevel ?? 2;
  const tag = `h${level}`;
  const styles = buildInlineStyles(node.styles);
  const content = node.content?.text ?? node.name;

  const linkOpen = safeLinkOpen(node.link, warnings, node.sourceNodeId, 'heading');
  const linkClose = linkOpen ? '</a>' : '';

  return `${pad}<${tag}${mobileClass(node)}${providerAttributes(node)} style="${styles}">${linkOpen}${escapeHtml(content)}${linkClose}</${tag}>`;
}

function emitText(
  node: EmailIrNode,
  indent: string,
  depth: number,
  _opts: EmailHtmlExportOptions,
  warnings: EmailIrWarning[],
  _assets: string[],
): string {
  const pad = indent.repeat(depth);
  const styles = buildInlineStyles(node.styles);

  if (node.content?.runs && node.content.runs.length > 0) {
    const runsHtml = node.content.runs.map((run) => emitTextRun(run)).join('');
    const nodeLink =
      node.link && !node.content.runs.some((run) => run.link)
        ? safeLinkOpen(node.link, warnings, node.sourceNodeId, 'text')
        : '';
    return `${pad}<p${mobileClass(node)}${providerAttributes(node)} style="${styles}">${nodeLink}${runsHtml}${nodeLink ? '</a>' : ''}</p>`;
  }

  const text = node.content?.text ?? '';
  const nodeLink = safeLinkOpen(node.link, warnings, node.sourceNodeId, 'text');
  return `${pad}<p${mobileClass(node)}${providerAttributes(node)} style="${styles}">${nodeLink}${escapeHtml(text)}${nodeLink ? '</a>' : ''}</p>`;
}

function emitTextRun(run: EmailIrTextRun): string {
  const styles = buildInlineStyles(run.styles);
  const text = escapeHtml(run.text);

  if (run.link) {
    const result = validateEmailUrl(run.link);
    if (!result.valid) return text;
    return `<a href="${escapeAttr(result.value)}"${run.link.target ? ` target="${escapeHtml(run.link.target)}"` : ''}${run.link.title ? ` title="${escapeHtml(run.link.title)}"` : ''} style="${styles}; text-decoration: underline; color: inherit;">${text}</a>`;
  }

  if (styles) {
    return `<span style="${styles}">${text}</span>`;
  }
  return text;
}

function emitImage(
  node: EmailIrNode,
  indent: string,
  depth: number,
  _opts: EmailHtmlExportOptions,
  warnings: EmailIrWarning[],
  assets: string[],
): string {
  const pad = indent.repeat(depth);
  const img = node.image;
  if (!img) return '';

  const src = resolveAssetUrl(img.src, _opts.assetBaseUrl);
  if (src) assets.push(src);

  const alt = escapeHtml(img.decorative ? '' : img.alt || node.alt || '');
  const width = img.width ? ` width="${img.width}"` : '';
  const styles = buildInlineStyles({
    ...node.styles,
    border: '0',
    display: 'block',
    'max-width': '100%',
  });

  const imgTag = `<img${providerAttributes(node)} src="${escapeHtml(src)}" alt="${alt}"${width} style="${styles}" />`;

  if (img.link || node.link) {
    const link = img.link ?? node.link!;
    const href = safeLinkOpen(link, warnings, node.sourceNodeId, 'image');
    return href
      ? `${pad}${href}\n${indent.repeat(depth + 1)}${imgTag}\n${pad}</a>`
      : `${pad}${imgTag}`;
  }

  return `${pad}${imgTag}`;
}

function emitButton(
  node: EmailIrNode,
  indent: string,
  depth: number,
  _opts: EmailHtmlExportOptions,
  warnings: EmailIrWarning[],
  _assets: string[],
): string {
  const pad = indent.repeat(depth);
  const innerPad = indent.repeat(depth + 1);
  const text = node.content?.text ?? 'Click';
  const link = node.link;

  // Button as table for Outlook compatibility
  const bgColor = node.styles['background-color'] ?? '#000000';
  const textColor = node.styles.color ?? '#ffffff';
  const padding = node.styles.padding ?? '12px 24px';
  const borderRadius = node.styles['border-radius'];

  const tableStyle = `border-collapse: separate; ${borderRadius ? `border-radius: ${borderRadius};` : ''}`;
  const cellStyle = `background-color: ${escapeHtml(bgColor)}; color: ${escapeHtml(textColor)}; padding: ${escapeHtml(padding)}; text-align: center; font-weight: bold; text-decoration: none; display: inline-block; ${borderRadius ? `border-radius: ${borderRadius};` : ''}`;

  if (link) {
    const href = safeLinkOpen(link, warnings, node.sourceNodeId, 'button');
    if (!href) return `${pad}<span style="${cellStyle}">${escapeHtml(text)}</span>`;
    return `${pad}<table${providerAttributes(node)} role="presentation" cellpadding="0" cellspacing="0" border="0" style="${tableStyle}">
${innerPad}<tr>
${innerPad}${indent}<td align="center" role="button" style="${cellStyle}">
${innerPad}${indent}${indent}${href.slice(0, -1)} style="color: ${escapeHtml(textColor)}; text-decoration: none; display: inline-block; padding: ${escapeHtml(padding)}; font-weight: bold;">${escapeHtml(text)}</a>
${innerPad}${indent}</td>
${innerPad}</tr>
${pad}</table>`;
  }

  return `${pad}<table${providerAttributes(node)} role="presentation" cellpadding="0" cellspacing="0" border="0" style="${tableStyle}">
${innerPad}<tr>
${innerPad}${indent}<td align="center" role="button" style="${cellStyle}">
${innerPad}${indent}${indent}<span style="color: ${escapeHtml(textColor)}; text-decoration: none;">${escapeHtml(text)}</span>
${innerPad}${indent}</td>
${innerPad}</tr>
${pad}</table>`;
}

function emitDivider(node: EmailIrNode, indent: string, depth: number): string {
  const pad = indent.repeat(depth);
  const styles = buildInlineStyles(node.styles);
  return `${pad}<hr style="${styles}; border: 0; border-top: 1px solid #e0e0e0; margin: 16px 0;" />`;
}

function emitSpacer(node: EmailIrNode, indent: string, depth: number): string {
  const pad = indent.repeat(depth);
  const height = node.height ?? 20;
  return `${pad}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
${indent.repeat(depth + 1)}<tr>
${indent.repeat(depth + 1)}${indent}<td style="height: ${height}px; line-height: ${height}px; font-size: 1px;">&nbsp;</td>
${indent.repeat(depth + 1)}</tr>
${pad}</table>`;
}

function emitCustomHtml(
  node: EmailIrNode,
  indent: string,
  depth: number,
  warnings: EmailIrWarning[],
): string {
  const pad = indent.repeat(depth);
  const html = node.content?.html;

  if (!html) return '';

  const sanitized = sanitizeEmailHtml(html);
  for (const removed of sanitized.removed) {
    warnings.push({
      severity: 'warning',
      code: 'UNSAFE_CUSTOM_HTML',
      message: `Removed unsupported custom HTML construct: ${removed}.`,
      sourceNodeId: node.sourceNodeId,
      category: 'security',
    });
  }
  return `${pad}${sanitized.html}`;
}

function emitPreheader(
  node: EmailIrNode,
  indent: string,
  depth: number,
  _warnings: EmailIrWarning[],
): string {
  const pad = indent.repeat(depth);
  const text = node.content?.text ?? '';
  // Hidden preheader for email preview text
  return `${pad}<div style="display: none; font-size: 1px; color: #ffffff; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">${escapeHtml(text)}</div>`;
}

function emitContainer(
  node: EmailIrNode,
  indent: string,
  depth: number,
  opts: EmailHtmlExportOptions,
  warnings: EmailIrWarning[],
  assets: string[],
): string {
  const pad = indent.repeat(depth);
  const innerPad = indent.repeat(depth + 1);
  const styles = buildInlineStyles(node.styles);

  const childrenHtml = node.children
    .map((child) => emitNode(child, indent, depth + 1, opts, warnings, assets))
    .join('\n');

  if (node.compatibility === 'converted' && node.children.length > 0) {
    return `${pad}<table${providerAttributes(node)} role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; ${styles}">\n${innerPad}<tr>\n${innerPad}${indent}<td valign="top" style="${styles}">\n${childrenHtml}\n${innerPad}${indent}</td>\n${innerPad}</tr>\n${pad}</table>`;
  }
  return `${pad}<div${mobileClass(node)} style="${styles}">\n${childrenHtml}\n${pad}</div>`;
}

// ── CSS Builders ──────────────────────────────────────────────────────────────

function buildResetCss(indent: string): string {
  return [
    `${indent}body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }`,
    `${indent}table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }`,
    `${indent}img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }`,
    `${indent}body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; }`,
    `${indent}a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }`,
  ].join('\n');
}

function buildBaseCss(
  settings: { contentWidth: number; contentBackground?: string },
  indent: string,
): string {
  return [
    `${indent}/* Base styles */`,
    `${indent}body { background-color: #f4f4f4; }`,
    `${indent}.email-container { max-width: ${settings.contentWidth}px; margin: 0 auto; ${settings.contentBackground ? `background-color: ${settings.contentBackground};` : ''} }`,
  ].join('\n');
}

function buildResponsiveCss(
  _ir: EmailDocumentIr,
  mobileBreakpoint: number,
  indent: string,
): string {
  return `
${indent}@media only screen and (max-width: ${mobileBreakpoint}px) {
${indent}  .email-container {
${indent}    width: 100% !important;
${indent}    max-width: 100% !important;
${indent}  }
${indent}  .stack-column,
${indent}  .stack-column-center {
${indent}    display: block !important;
${indent}    width: 100% !important;
${indent}    max-width: 100% !important;
${indent}    direction: ltr !important;
${indent}  }
${indent}  .stack-column-center {
${indent}    text-align: center !important;
${indent}  }
${indent}  .mobile-padding {
${indent}    padding-left: 20px !important;
${indent}    padding-right: 20px !important;
${indent}  }
${indent}  .mobile-hide {
${indent}    display: none !important;
${indent}  }
${indent}  img {
${indent}    max-width: 100% !important;
${indent}    height: auto !important;
${indent}  }
${indent}}`;
}

function buildMsoHead(contentWidth: number, bodyBackground?: string): string {
  return `
    <style type="text/css">
      body { background-color: ${bodyBackground ?? '#ffffff'}; }
      table { border-collapse: collapse; mso-spacing: 0; }
      img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
      .email-container { max-width: ${contentWidth}px; }
    </style>
    <!--[if gte mso 9]>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
    <![endif]-->`;
}

function buildPreheader(text: string, indent: string): string {
  return `${indent}<div style="display: none; font-size: 1px; color: #fefefe; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">${escapeHtml(text)}${'\u200B'.repeat(100)}</div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildInlineStyles(styles: Record<string, string>): string {
  return Object.entries(styles)
    .filter(([_, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function safeLinkOpen(
  link: EmailIrLink | undefined,
  warnings: EmailIrWarning[],
  sourceNodeId: string | undefined,
  context: string,
): string {
  if (!link) return '';
  const result = validateEmailUrl(link);
  if (!result.valid) {
    warnings.push({
      severity: 'error',
      code: 'INVALID_LINK',
      message: `${context} link was omitted: ${result.reason ?? 'invalid URL'}.`,
      sourceNodeId,
      category: 'link',
    });
    return '';
  }
  return `<a href="${escapeAttr(result.value)}"${link.target ? ` target="${escapeHtml(link.target)}"` : ''}${link.title ? ` title="${escapeHtml(link.title)}"` : ''} style="text-decoration: none;">`;
}

function mobileClass(node: EmailIrNode): string {
  const classes = [
    node.hideOnMobile ? 'mobile-hide' : '',
    node.mobileBehavior === 'stack' ? 'stack-column' : '',
  ].filter(Boolean);
  return classes.length ? ` class="${classes.join(' ')}"` : '';
}

function providerAttributes(node: EmailIrNode): string {
  return Object.entries(node.providerAttributes ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
    .join('');
}

function resolveAssetUrl(src: string, baseUrl?: string): string {
  if (!src) return '';
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('data:')) return src;
  if (baseUrl) return `${baseUrl.replace(/\/$/, '')}/${src.replace(/^\//, '')}`;
  return src;
}
