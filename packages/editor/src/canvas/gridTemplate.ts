/**
 * Parse a simple grid-template string like "1fr 200px 1fr" into pixel sizes.
 * Only handles px and fr units. fr units divide remaining space equally.
 */
export function parseGridTemplate(template: string, totalSize: number): number[] {
  const parts = template.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  let frCount = 0;
  let pxUsed = 0;
  const sizes: (number | 'fr')[] = [];
  for (const p of parts) {
    if (p.endsWith('fr')) {
      const n = Number.parseFloat(p);
      frCount += n;
      sizes.push('fr');
    } else if (p.endsWith('px')) {
      const n = Number.parseFloat(p);
      pxUsed += n;
      sizes.push(n);
    } else {
      const n = Number.parseFloat(p);
      if (!Number.isNaN(n)) {
        pxUsed += n;
        sizes.push(n);
      }
    }
  }
  const frPx = frCount > 0 ? Math.max(0, (totalSize - pxUsed) / frCount) : 0;
  return sizes.map((s) => (s === 'fr' ? frPx : s));
}
