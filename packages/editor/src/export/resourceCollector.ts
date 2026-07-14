import type { SceneNode } from '@strata/scene';

export interface ImageResource {
  id: string;
  mime_type: string;
  width: number;
  height: number;
  data: number[];
  color_space: 'rgb' | 'cmyk' | 'gray';
}

export interface PatternResource {
  id: string;
  tile_image_id: string;
  spacing: number;
  rotation: number;
  tile_width: number;
  tile_height: number;
}

export interface ExportManifest {
  images: ImageResource[];
  patterns: PatternResource[];
}

// Counter for stable IDs
let imageCounter = 0;

function resetCounter() {
  imageCounter = 0;
}

function nextImageId(): string {
  return `img_${imageCounter++}`;
}

/** Collect all unique image and pattern resources from scene nodes */
export function collectResources(nodes: SceneNode[]): ExportManifest {
  resetCounter();
  const images: ImageResource[] = [];
  const patterns: PatternResource[] = [];
  const srcToId = new Map<string, string>();

  for (const node of nodes) {
    const fills = (node as Record<string, unknown>).fills;
    if (!Array.isArray(fills)) continue;

    for (const fill of fills) {
      const f = fill as Record<string, unknown>;
      if (f.type === 'image' && f.visible !== false) {
        const img = f.image as Record<string, unknown> | undefined;
        const src = img?.src as string | undefined;
        if (src && !srcToId.has(src)) {
          const id = nextImageId();
          srcToId.set(src, id);
          images.push({
            id,
            mime_type: guessMimeType(src),
            width: (img?.width as number) ?? 0,
            height: (img?.height as number) ?? 0,
            data: [], // Will be populated by the caller after loading
            color_space: 'rgb',
          });
        }
      }

      if (f.type === 'pattern' && f.visible !== false) {
        const pat = f.pattern as Record<string, unknown> | undefined;
        const tileSrc = pat?.tileSrc as string | undefined;
        if (tileSrc) {
          let tileId = srcToId.get(tileSrc);
          if (!tileId) {
            tileId = nextImageId();
            srcToId.set(tileSrc, tileId);
            images.push({
              id: tileId,
              mime_type: guessMimeType(tileSrc),
              width: (pat?.imageWidth as number) ?? 0,
              height: (pat?.imageHeight as number) ?? 0,
              data: [],
              color_space: 'rgb',
            });
          }
          patterns.push({
            id: `pat_${patterns.length}`,
            tile_image_id: tileId,
            spacing: (pat?.spacing as number) ?? 0,
            rotation: (pat?.rotation as number) ?? 0,
            tile_width: (pat?.imageWidth as number) ?? 32,
            tile_height: (pat?.imageHeight as number) ?? 32,
          });
        }
      }
    }
  }

  return { images, patterns };
}

function guessMimeType(src: string): string {
  if (src.endsWith('.png') || src.startsWith('data:image/png')) return 'image/png';
  if (src.endsWith('.jpg') || src.endsWith('.jpeg') || src.startsWith('data:image/jpeg'))
    return 'image/jpeg';
  if (src.endsWith('.webp') || src.startsWith('data:image/webp')) return 'image/webp';
  return 'image/png';
}
