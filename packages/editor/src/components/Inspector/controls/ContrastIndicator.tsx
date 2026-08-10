import { contrastRatio, relativeLuminance, WCAG_AA_LARGE, WCAG_AA_NORMAL } from '@varve/shared';
import { Icon, Tooltip } from '@varve/ui';

export interface ContrastIndicatorProps {
  fgColor?: { r: number; g: number; b: number } | null;
  bgColor?: { r: number; g: number; b: number } | null;
  /** Override font size to differentiate normal vs large text (px). */
  fontSize?: number;
  /** Override font weight for large-text determination. */
  fontWeight?: number;
}

function isLargeText(fontSize: number, fontWeight?: number): boolean {
  const pt = fontSize * 0.75;
  return pt >= 18 || (pt >= 14 && (fontWeight ?? 400) >= 700);
}

function colorToRgb(
  c: { r: number; g: number; b: number } | undefined | null,
): { r: number; g: number; b: number } | null {
  if (!c) return null;
  if (typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number') {
    return { r: c.r, g: c.g, b: c.b };
  }
  return null;
}

export function ContrastIndicator({
  fgColor,
  bgColor,
  fontSize = 16,
  fontWeight = 400,
}: ContrastIndicatorProps) {
  const fg = colorToRgb(fgColor);
  const bg = colorToRgb(bgColor);

  const large = isLargeText(fontSize, fontWeight);
  const minRatio = large ? WCAG_AA_LARGE : WCAG_AA_NORMAL;

  const computeLabel = (ratio: number): { color: string; label: string } => {
    const passAA = ratio >= minRatio;
    const passAAA = ratio >= (large ? WCAG_AA_LARGE * 1.4 : WCAG_AA_NORMAL * 1.5);
    if (passAAA) return { color: 'var(--color-feedback-success)', label: 'AAA' };
    if (passAA) return { color: 'var(--color-feedback-success)', label: 'AA' };
    return { color: 'var(--color-feedback-danger)', label: 'Fail' };
  };

  const checkBg = (r: number, g: number, b: number) => {
    const l = relativeLuminance(r, g, b);
    return contrastRatio(relativeLuminance(fg!.r, fg!.g, fg!.b), l);
  };

  if (!fg) {
    return (
      <Tooltip label="No foreground color to check">
        <span
          className="contrast-indicator"
          role="status"
          aria-label="No foreground color to check"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
        >
          <Icon name="CircleQuestionMark" size={10} label={undefined} />
        </span>
      </Tooltip>
    );
  }

  let ratio: number;
  let bgLabel: string;

  if (bg) {
    ratio = checkBg(bg.r, bg.g, bg.b);
    bgLabel = '';
  } else {
    const ratioWhite = checkBg(255, 255, 255);
    const ratioBlack = checkBg(0, 0, 0);
    if (ratioWhite >= ratioBlack) {
      ratio = ratioWhite;
      bgLabel = 'on white';
    } else {
      ratio = ratioBlack;
      bgLabel = 'on black';
    }
  }

  const { color, label } = computeLabel(ratio);

  const tooltipLabel = `${ratio.toFixed(2)}:1${bgLabel ? ` ${bgLabel}` : ''} — ${label === 'Fail' ? 'Below WCAG AA' : `WCAG ${label}`} ${large ? '(large text)' : '(normal text)'}`;

  return (
    <Tooltip label={tooltipLabel}>
      <span
        className="contrast-indicator"
        role="status"
        aria-label={`Contrast ${label}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color,
          }}
        />
        <span style={{ fontSize: '0.7em', lineHeight: 1 }}>{label}</span>
      </span>
    </Tooltip>
  );
}
