/**
 * Icon audit — validates icon SVG content against best practices and standards.
 */

export type IconAuditSeverity = 'error' | 'warning' | 'info';

export interface IconAuditFinding {
  id: string;
  severity: IconAuditSeverity;
  category: string;
  message: string;
  line?: number;
}

export interface IconAuditResult {
  findings: IconAuditFinding[];
  score: number;
  passed: boolean;
}

const CATEGORY = {
  STROKE: 'Stroke',
  FILL: 'Fill',
  VIEWBOX: 'ViewBox',
  STRUCTURE: 'Structure',
  ACCESSIBILITY: 'Accessibility',
  SECURITY: 'Security',
  SIZE: 'Size',
  PERFORMANCE: 'Performance',
} as const;

let findingCounter = 0;
function makeFinding(
  severity: IconAuditSeverity,
  category: string,
  message: string,
  line?: number,
): IconAuditFinding {
  return {
    id: `audit-${++findingCounter}`,
    severity,
    category,
    message,
    line,
  };
}

export function auditIconSvg(svg: string): IconAuditResult {
  const findings: IconAuditFinding[] = [];

  if (!svg?.trim()) {
    findings.push(makeFinding('error', CATEGORY.STRUCTURE, 'Empty SVG content'));
    return { findings, score: 0, passed: false };
  }

  if (!svg.includes('viewBox=')) {
    findings.push(makeFinding('warning', CATEGORY.VIEWBOX, 'Missing viewBox attribute'));
  } else {
    const vbMatch = svg.match(/viewBox="([^"]+)"/);
    if (vbMatch?.[1]) {
      const parts = vbMatch[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
        findings.push(makeFinding('error', CATEGORY.VIEWBOX, `Invalid viewBox: "${vbMatch[1]}"`));
      } else if (parts[0] !== 0 || parts[1] !== 0) {
        findings.push(
          makeFinding('info', CATEGORY.VIEWBOX, `ViewBox does not start at origin: ${vbMatch[1]}`),
        );
      } else if (parts[2] !== parts[3]) {
        findings.push(
          makeFinding('warning', CATEGORY.VIEWBOX, `Non-square viewBox: ${parts[2]}x${parts[3]}`),
        );
      }
    }
  }

  const strokeWidths = new Set<string>();
  const swRegex = /stroke-width="([^"]+)"/g;
  let swMatch: RegExpExecArray | null = swRegex.exec(svg);
  while (swMatch !== null) {
    if (swMatch[1]) strokeWidths.add(swMatch[1]);
    swMatch = swRegex.exec(svg);
  }
  if (strokeWidths.size > 1) {
    findings.push(
      makeFinding(
        'warning',
        CATEGORY.STROKE,
        `Multiple stroke widths: ${[...strokeWidths].join(', ')}`,
      ),
    );
  }

  const strokeCaps = new Set<string>();
  const scRegex = /stroke-linecap="([^"]+)"/g;
  let scMatch: RegExpExecArray | null = scRegex.exec(svg);
  while (scMatch !== null) {
    if (scMatch[1]) strokeCaps.add(scMatch[1]);
    scMatch = scRegex.exec(svg);
  }
  if (strokeCaps.size > 1) {
    findings.push(
      makeFinding(
        'warning',
        CATEGORY.STROKE,
        `Mixed stroke-linecap values: ${[...strokeCaps].join(', ')}`,
      ),
    );
  }

  if (/fill="#000000"|fill="black"|fill="#000"/i.test(svg)) {
    findings.push(
      makeFinding('info', CATEGORY.FILL, 'Hardcoded black fill - consider using currentColor'),
    );
  }
  if (/fill="#FFFFFF"|fill="white"|fill="#fff"/i.test(svg)) {
    findings.push(
      makeFinding(
        'info',
        CATEGORY.FILL,
        'Hardcoded white fill - may be invisible on light backgrounds',
      ),
    );
  }
  if (!svg.includes('fill=') && !svg.includes('stroke=') && !svg.includes('style=')) {
    findings.push(
      makeFinding('warning', CATEGORY.FILL, 'No fill or stroke specified - icon may be invisible'),
    );
  }

  if (svg.includes('<script')) {
    findings.push(makeFinding('error', CATEGORY.SECURITY, 'Contains <script> element'));
  }
  if (/on\w+\s*=/.test(svg)) {
    findings.push(makeFinding('error', CATEGORY.SECURITY, 'Contains event handler attributes'));
  }
  if (svg.includes('foreignObject')) {
    findings.push(makeFinding('error', CATEGORY.SECURITY, 'Contains foreignObject element'));
  }
  if (/javascript:/i.test(svg)) {
    findings.push(makeFinding('error', CATEGORY.SECURITY, 'Contains javascript: URL'));
  }

  const pathCount = (svg.match(/<path/g) ?? []).length;
  if (pathCount > 100) {
    findings.push(
      makeFinding('warning', CATEGORY.PERFORMANCE, `High path count: ${pathCount} paths`),
    );
  }

  if (/<title>/.test(svg)) {
    findings.push(
      makeFinding('info', CATEGORY.ACCESSIBILITY, 'Has <title> element (good for accessibility)'),
    );
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;
  const score = Math.max(0, 100 - errorCount * 20 - warningCount * 5 - infoCount * 1);

  return { findings, score, passed: errorCount === 0 };
}

export function auditIconCollection(icons: Array<{ id: string; svg: string }>): {
  totalIcons: number;
  passed: number;
  failed: number;
  totalFindings: number;
  bySeverity: Record<IconAuditSeverity, number>;
} {
  let passedCount = 0;
  let failedCount = 0;
  let totalFindings = 0;
  const bySeverity: Record<IconAuditSeverity, number> = { error: 0, warning: 0, info: 0 };

  for (const icon of icons) {
    const result = auditIconSvg(icon.svg);
    if (result.passed) passedCount++;
    else failedCount++;
    totalFindings += result.findings.length;
    for (const f of result.findings) {
      bySeverity[f.severity]++;
    }
  }

  return {
    totalIcons: icons.length,
    passed: passedCount,
    failed: failedCount,
    totalFindings,
    bySeverity,
  };
}
