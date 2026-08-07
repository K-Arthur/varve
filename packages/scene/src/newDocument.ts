/**
 * Canonical new-document creation service.
 *
 * Every "create a document" entry point — home-screen New button, empty
 * state, File → New, Ctrl+N, command palette, template creation, and
 * frame-preset creation — should funnel through `createNewDocument` so a
 * request produces a fully initialized document atomically, with one
 * behavior:
 *
 *   - A new Varve document is an untitled infinite-canvas document.
 *   - Width/height belong to frames (or pages/print layouts), never to the
 *     root document — so the base document is flat (page-less) unless a
 *     template brings its own pages.
 *   - "Start with a frame" inserts exactly one frame node with the preset's
 *     (or custom) dimensions; the document itself stays unbounded.
 *   - Print/advanced settings (color mode, bit depth, bleed, dpi, profile)
 *     are document-level metadata; they never resize the document.
 *
 * `createDocumentFromPreset` (presetToDocument.ts) remains for legacy and
 * print-first flows that genuinely want a fixed-size page document
 * (import/export/print paths depend on physicalWidth/Height).
 */

import type { BitDepth } from '@varve/shared';
import {
  BLANK_DOCUMENT_PRESET,
  type ColorMode,
  type Preset,
  type PresetBleed,
  physicalToPx,
} from '@varve/shared';
import { defaultColorConfig, uniformBleed } from './colorManagement';
import { createDocument, type Document, makeFrameNode, nextNodeId } from './document';
import { addNode } from './document-nodes';
import { DocumentCodec } from './documentCodec';
import { resolveColorProfileRef } from './presetToDocument';
import type { NodeId } from './types';

/** Hard ceiling for an initial frame's larger dimension, in the document's
 *  fixed-96dpi world unit. Mirrors the engine's practical scene limits. */
export const MAX_FRAME_DIMENSION = 100_000;

export type NewDocumentStartMode = 'empty' | 'pages' | 'framePreset' | 'customFrame' | 'template';

export interface NewDocumentCustomFrame {
  width: number;
  height: number;
  unit: import('@varve/shared').DocumentUnit;
}

export interface NewDocumentRequest {
  /** Document name (display name, not a filename). Defaults to 'Untitled'. */
  documentName?: string;
  /** What the new document starts with. Defaults to 'empty'. */
  startMode?: NewDocumentStartMode;
  /** Frame preset to materialize as the initial frame ('framePreset'). */
  preset?: Preset;
  /** Custom frame dimensions ('customFrame'). */
  customFrame?: NewDocumentCustomFrame;
  /** Serialized template document ('template'); decoded through the same
   *  versioned migration pipeline as any opened file. */
  templateJson?: string;
  // ── Advanced document settings (all optional, safe screen defaults) ──────
  colorMode?: ColorMode;
  bitDepth?: 8 | 16;
  bleed?: PresetBleed;
  dpi?: number;
  colorProfileId?: string;
}

export interface NewDocumentResult {
  document: Document;
  /** Node id of the inserted initial frame, when the request asked for one. */
  initialFrameId?: NodeId;
  /** Template decode produced warnings (never fatal). */
  warnings?: string[];
}

export type NewDocumentRequestError =
  | { ok: false; error: string }
  | { ok: true; result: NewDocumentResult };

/** Validate a custom-frame request. Returns an error message or null. */
export function validateCustomFrame(frame: NewDocumentCustomFrame): string | null {
  const { width, height, unit } = frame;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return 'Width and height must be numbers.';
  }
  if (width <= 0 || height <= 0) {
    return 'Width and height must be greater than zero.';
  }
  const wPx = physicalToPx(width, unit);
  const hPx = physicalToPx(height, unit);
  if (wPx > MAX_FRAME_DIMENSION || hPx > MAX_FRAME_DIMENSION) {
    return `Frame dimensions are too large (maximum ${MAX_FRAME_DIMENSION}px).`;
  }
  return null;
}

/** Map a preset's 8/16/32 bit-depth number onto the engine's BitDepth. */
export function bitDepthToEngine(bits?: 8 | 16 | 32): BitDepth | undefined {
  if (bits === 16) return 'uint16';
  if (bits === 32) return 'float32';
  return 'uint8';
}

/** Build the initial frame node for a preset/custom size. */
export function makeInitialFrame(
  doc: Document,
  input: {
    name: string;
    width: number;
    height: number;
    unit: import('@varve/shared').DocumentUnit;
  },
): { doc: Document; id: NodeId } {
  const w = physicalToPx(input.width, input.unit);
  const h = physicalToPx(input.height, input.unit);
  const { id, doc: d } = nextNodeId(doc);
  const frame = makeFrameNode(id, {
    name: input.name,
    w,
    h,
    children: [],
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
  });
  return { doc: addNode(d, frame), id };
}

/** Create a fully initialized new document from a typed request. */
export function createNewDocument(request: NewDocumentRequest): NewDocumentRequestError {
  const startMode = request.startMode ?? 'empty';

  if (startMode === 'template') {
    if (!request.templateJson) {
      return { ok: false, error: 'No template payload provided.' };
    }
    const decoded = DocumentCodec.decode(request.templateJson);
    if (!decoded.ok) {
      return { ok: false, error: decoded.error ?? 'Template could not be read.' };
    }
    if (!decoded.document) {
      return { ok: false, error: 'Template contained no document.' };
    }
    const doc: Document = {
      ...decoded.document,
      name: request.documentName?.trim() || decoded.document.name || 'Untitled',
    };
    return {
      ok: true,
      result: { document: doc, warnings: decoded.warnings?.map((w) => w.message) },
    };
  }

  if (startMode === 'customFrame' && request.customFrame) {
    const error = validateCustomFrame(request.customFrame);
    if (error) return { ok: false, error };
  }

  // Base: an infinite-canvas, page-less document. Never carries a default
  // page size — dimensions arrive only via an initial frame or template.
  // 'pages' start mode (M14): a paged document with one default page — the
  // entry point for print/publication documents.
  let doc =
    startMode === 'pages'
      ? createDocument(request.documentName?.trim() || 'Untitled', false)
      : createDocument(request.documentName?.trim() || 'Untitled', { flat: true });

  let initialFrameId: NodeId | undefined;
  if (
    startMode === 'framePreset' &&
    request.preset &&
    request.preset.id !== BLANK_DOCUMENT_PRESET.id
  ) {
    const { doc: d, id } = makeInitialFrame(doc, {
      name: request.preset.name,
      width: request.preset.width,
      height: request.preset.height,
      unit: request.preset.unit,
    });
    doc = d;
    initialFrameId = id;
  } else if (startMode === 'customFrame' && request.customFrame) {
    const { doc: d, id } = makeInitialFrame(doc, {
      name: 'Custom frame',
      width: request.customFrame.width,
      height: request.customFrame.height,
      unit: request.customFrame.unit,
    });
    doc = d;
    initialFrameId = id;
  }

  // Advanced document settings — document-level metadata only.
  const colorMode = request.colorMode ?? request.preset?.colorMode;
  if (colorMode) {
    doc = {
      ...doc,
      colorConfig: defaultColorConfig(
        colorMode,
        bitDepthToEngine(request.bitDepth ?? request.preset?.bitDepth),
      ),
    };
  }
  if (request.bleed ?? request.preset?.bleed) {
    const bleed = request.bleed ?? request.preset?.bleed;
    if (bleed) doc = { ...doc, bleed: uniformBleed(bleed.value, bleed.unit) };
  }
  const dpi = request.dpi ?? request.preset?.dpi;
  if (dpi) doc = { ...doc, dpi };
  const profileId = request.colorProfileId ?? request.preset?.colorProfileId;
  if (profileId) {
    const profile = resolveColorProfileRef(profileId);
    if (profile && doc.colorConfig) {
      const key = doc.colorConfig.mode === 'cmyk' ? 'cmykProfile' : 'rgbProfile';
      doc = { ...doc, colorConfig: { ...doc.colorConfig, [key]: profile } };
    }
  }

  return { ok: true, result: { document: doc, initialFrameId } };
}
