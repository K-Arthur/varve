/**
 * AI disclosure metadata for exports.
 *
 * When a document contains AI-edited content (via Generative Edit, Background
 * Removal, etc.), exports can embed metadata describing which tools were used.
 * This implements IPTC DigitalSourceType disclosure for PNG/JPEG/WebP/PDF.
 */

import type { Document, NodeId } from '@varve/scene';
import { getNodeAiEditInfo } from '../components/LayersPanel/aiEditedBadge';

export interface AiDisclosureMetadata {
  /** IPTC DigitalSourceType URI */
  digitalSourceType: string;
  /** Human-readable description of AI tools used */
  description: string;
  /** Individual tool names */
  tools: string[];
}

/**
 * Check if a document contains any AI-edited content.
 * Returns disclosure metadata if AI was used, null otherwise.
 */
export function getDocumentAiDisclosure(
  doc: Document,
  nodeIds?: NodeId[],
): AiDisclosureMetadata | null {
  if (!doc.generativeEdits || Object.keys(doc.generativeEdits).length === 0) {
    return null;
  }

  const tools = new Set<string>();
  const models = new Set<string>();

  // If specific nodes are provided, check only those
  if (nodeIds) {
    for (const nodeId of nodeIds) {
      const info = getNodeAiEditInfo(doc, nodeId);
      if (info) {
        tools.add(info.label);
        if (info.model && info.model !== 'Unknown') {
          models.add(info.model);
        }
      }
    }
  } else {
    // Check all generative edits in the document
    for (const edit of Object.values(doc.generativeEdits)) {
      const modeLabel: Record<typeof edit.mode, string> = {
        fill: 'AI Fill',
        remove: 'AI Remove',
        replace: 'AI Replace',
        expand: 'AI Expand',
      };
      tools.add(modeLabel[edit.mode] ?? 'AI Edit');

      const provider = edit.provider;
      const modelName =
        provider.modelId ?? (provider.runtime === 'patchmatch' ? 'PatchMatch' : null);
      if (modelName) {
        models.add(modelName);
      }
    }
  }

  if (tools.size === 0) {
    return null;
  }

  const toolsList = Array.from(tools).sort();
  const modelsList = Array.from(models).sort();

  const description =
    modelsList.length > 0
      ? `AI tools used: ${toolsList.join(', ')} (models: ${modelsList.join(', ')})`
      : `AI tools used: ${toolsList.join(', ')}`;

  return {
    // IPTC DigitalSourceType for composite with trained algorithmic media
    digitalSourceType:
      'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
    description,
    tools: toolsList,
  };
}

/**
 * Generate XMP metadata string for AI disclosure.
 * Follows IPTC Extension schema.
 */
export function generateAiDisclosureXmp(disclosure: AiDisclosureMetadata): string {
  const escapedDesc = disclosure.description
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description
      xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
      xmlns:dc="http://purl.org/dc/elements/1.1/">
      <Iptc4xmpExt:DigitalSourceType>${disclosure.digitalSourceType}</Iptc4xmpExt:DigitalSourceType>
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escapedDesc}</rdf:li>
        </rdf:Alt>
      </dc:description>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Generate SVG metadata element for AI disclosure.
 */
export function generateAiDisclosureSvgMetadata(disclosure: AiDisclosureMetadata): string {
  const escapedDesc = disclosure.description
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<metadata>
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
           xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
           xmlns:dc="http://purl.org/dc/elements/1.1/">
    <rdf:Description>
      <Iptc4xmpExt:DigitalSourceType>${disclosure.digitalSourceType}</Iptc4xmpExt:DigitalSourceType>
      <dc:description>${escapedDesc}</dc:description>
    </rdf:Description>
  </rdf:RDF>
</metadata>`;
}

/** Insert the SVG metadata block immediately before the root `</svg>`. */
export function applyAiDisclosureToSvg(
  svg: string,
  disclosure: AiDisclosureMetadata | null,
): string {
  if (!disclosure) return svg;
  const metadata = generateAiDisclosureSvgMetadata(disclosure);
  const close = svg.lastIndexOf('</svg>');
  if (close === -1) return `${svg}\n${metadata}\n`;
  return `${svg.slice(0, close)}${metadata}\n${svg.slice(close)}`;
}
