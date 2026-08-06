/**
 * Page numbering resolver (ADR-0131).
 *
 * One deterministic pass assigns every page its section, display number,
 * formatted string, and parity. Display numbers derive from section rules;
 * parity derives from the display number within its section, so section
 * restarts keep left/right parity correct in RTL bindings (ADR-0129 D5).
 *
 * Page identity is never the display number: page IDs are persistent; the
 * resolver output is derived state, recomputed per document revision.
 */

import type { Document } from './document';
import type { NodeId, PageNumberStyle, PageSection } from './types';

export interface PageNumberingEntry {
  pageId: NodeId;
  /** 0-based position in the pages array (order). */
  index: number;
  /** Owning section, when the page falls inside one. */
  sectionId?: NodeId;
  sectionName?: string;
  /** Display number (section-relative). */
  number: number;
  /** Formatted display string (style + prefix); '' when numbers hidden. */
  formatted: string;
  /** Whether the section shows page numbers. */
  showNumber: boolean;
  /** Parity of the display number. */
  parity: 'odd' | 'even';
  isFirstInSection: boolean;
  isLastInSection: boolean;
}

/** Roman numeral mapping (shared with legacy getFormattedPageNumber). */
const ROMAN_NUMERALS: Array<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

function toRoman(num: number): string {
  if (num <= 0) return '';
  let result = '';
  let n = num;
  for (const [value, numeral] of ROMAN_NUMERALS) {
    while (n >= value) {
      result += numeral;
      n -= value;
    }
  }
  return result;
}

function numToAlpha(num: number): string {
  let result = '';
  let n = num;
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function formatNumber(num: number, style: PageNumberStyle, prefix?: string): string {
  let formatted: string;
  switch (style) {
    case 'upperRoman':
      formatted = toRoman(num);
      break;
    case 'lowerRoman':
      formatted = toRoman(num).toLowerCase();
      break;
    case 'upperAlpha':
      formatted = numToAlpha(num).toUpperCase();
      break;
    case 'lowerAlpha':
      formatted = numToAlpha(num);
      break;
    default:
      formatted = String(num);
  }
  return prefix ? `${prefix}${formatted}` : formatted;
}

/**
 * Single-pass numbering resolution. Sections are matched by their
 * `startPageOrder` against the pages array (same rule as the legacy
 * getPageNumber); each page belongs to the section whose start is the
 * latest one at or before its position.
 */
export function computePageNumbering(doc: Document): Map<NodeId, PageNumberingEntry> {
  const result = new Map<NodeId, PageNumberingEntry>();
  const pages = doc.pages ?? [];
  if (pages.length === 0) return result;

  const sections = (doc.sections ?? []).slice();

  interface SectionSlot {
    section: PageSection;
    startIndex: number;
  }
  const slots: SectionSlot[] = [];
  for (const section of sections) {
    const startIndex = pages.findIndex((p) => p.order === section.startPageOrder);
    if (startIndex !== -1) slots.push({ section, startIndex });
  }
  slots.sort((a, b) => a.startIndex - b.startIndex);

  let slotIdx = 0;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]!;
    while (slotIdx < slots.length && slots[slotIdx]!.startIndex <= index) {
      slotIdx += 1;
    }
    const slot = slotIdx > 0 ? slots[slotIdx - 1] : undefined;

    const number = slot ? slot.section.startNumber + (index - slot.startIndex) : index + 1;
    const showNumber = slot ? slot.section.showPageNumber : true;
    const style = slot ? slot.section.numberStyle : 'decimal';
    const prefix = slot?.section.prefix;

    const nextSlotStart = slotIdx < slots.length ? slots[slotIdx]!.startIndex : pages.length;
    const isFirstInSection = slot ? index === slot.startIndex : false;
    const isLastInSection = slot ? index === nextSlotStart - 1 : false;

    result.set(page.id, {
      pageId: page.id,
      index,
      ...(slot ? { sectionId: slot.section.id, sectionName: slot.section.name } : {}),
      number,
      formatted: showNumber ? formatNumber(number, style, prefix) : '',
      showNumber,
      parity: number % 2 === 1 ? 'odd' : 'even',
      isFirstInSection,
      isLastInSection,
    });
  }

  return result;
}

/**
 * Resolve the numbering entry for one page (derived; recomputed per call).
 */
export function getPageNumbering(doc: Document, pageId: NodeId): PageNumberingEntry | undefined {
  return computePageNumbering(doc).get(pageId);
}
