/**
 * MockupTemplatePreview — accurate vector preview of a mockup template,
 * rendered from its template data (plate shapes + surface slots). No raster
 * assets needed, so built-in and user templates preview offline and at any
 * size. Surface slots are outlined; perspective slots show their quad.
 */

import type { MockupTemplateAsset, MockupVectorShape } from '@varve/scene';

interface Props {
  template: MockupTemplateAsset;
  width?: number;
  height?: number;
  className?: string;
}

function ShapeSvg({ shape }: { shape: MockupVectorShape }): React.ReactElement {
  if (shape.kind === 'rect') {
    return (
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        rx={shape.rx ?? 0}
        fill={shape.fill}
        opacity={shape.opacity ?? 1}
        transform={
          shape.rotation
            ? `rotate(${shape.rotation} ${shape.x + shape.width / 2} ${shape.y + shape.height / 2})`
            : undefined
        }
      />
    );
  }
  return (
    <ellipse
      cx={shape.x + shape.width / 2}
      cy={shape.y + shape.height / 2}
      rx={shape.width / 2}
      ry={shape.height / 2}
      fill={shape.fill}
      opacity={shape.opacity ?? 1}
    />
  );
}

function shapeKey(shape: MockupVectorShape, index: number): string {
  const s = shape as { x?: number; y?: number; width?: number; height?: number; fill?: string };
  return `${shape.kind}-${index}-${s.x ?? ''}-${s.y ?? ''}-${s.width ?? ''}-${s.height ?? ''}-${s.fill ?? ''}`;
}

export function MockupTemplatePreview({
  template,
  width,
  height,
  className,
}: Props): React.ReactElement {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${template.outputWidth} ${template.outputHeight}`}
      width={width}
      height={height}
      role="img"
      aria-label={template.name}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        x="0"
        y="0"
        width={template.outputWidth}
        height={template.outputHeight}
        fill={template.backgroundColor}
      />
      {template.plate.map((shape, i) => (
        <ShapeSvg key={shapeKey(shape, i)} shape={shape} />
      ))}
      {template.surfaces.map((surface) => (
        <g key={surface.id}>
          {(surface.plate ?? []).map((shape, i) => (
            <ShapeSvg key={shapeKey(shape, i)} shape={shape} />
          ))}
          {surface.kind === 'quad' && surface.quad ? (
            <polygon
              points={surface.quad.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#2b9bd6"
              strokeWidth={Math.max(2, template.outputWidth / 300)}
              strokeDasharray={`${Math.max(4, template.outputWidth / 150)} ${Math.max(3, template.outputWidth / 200)}`}
            />
          ) : (
            <rect
              x={surface.x}
              y={surface.y}
              width={surface.width}
              height={surface.height}
              fill="none"
              stroke="#2b9bd6"
              strokeWidth={Math.max(2, template.outputWidth / 300)}
              strokeDasharray={`${Math.max(4, template.outputWidth / 150)} ${Math.max(3, template.outputWidth / 200)}`}
            />
          )}
        </g>
      ))}
    </svg>
  );
}
