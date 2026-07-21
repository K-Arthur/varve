import { describe, expect, it } from 'vitest';
import { parseSvg } from './svg';

describe('SVG clipPath import (D12)', () => {
  it('imports a basic clipPath applied to a group', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <clipPath id="c1">
          <rect width="50" height="50"/>
        </clipPath>
      </defs>
      <g clip-path="url(#c1)">
        <rect width="100" height="100" fill="red"/>
      </g>
    </svg>`;
    const result = parseSvg(svg);
    expect(result.warnings.filter((w) => w.includes('clipPath')).length).toBe(0);
    const groupNode = Object.values(result.document.nodes).find(
      (n) => n.kind === 'frame' && n.name === 'Group',
    );
    expect(groupNode).toBeDefined();
    expect(groupNode!.mask).toBeDefined();
    expect(groupNode!.mask!.type).toBe('clip');
    if (groupNode!.kind === 'frame' || groupNode!.kind === 'group') {
      const children = groupNode!.children;
      expect(children.length).toBeGreaterThan(0);
      expect(children[0]).toBe(groupNode!.mask!.sourceNodeId);
    }
  });

  it('imports a clipPath applied to a leaf element by wrapping in group', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <clipPath id="c2">
          <circle cx="25" cy="25" r="20"/>
        </clipPath>
      </defs>
      <rect width="100" height="100" fill="blue" clip-path="url(#c2)"/>
    </svg>`;
    const result = parseSvg(svg);
    const maskedGroup = Object.values(result.document.nodes).find(
      (n) => n.kind === 'frame' && n.name === 'Masked Group',
    );
    expect(maskedGroup).toBeDefined();
    expect(maskedGroup!.mask).toBeDefined();
    expect(maskedGroup!.mask!.type).toBe('clip');
  });

  it('warns on missing clipPath reference', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g clip-path="url(#nonexistent)">
        <rect width="100" height="100"/>
      </g>
    </svg>`;
    const result = parseSvg(svg);
    expect(result.warnings.some((w) => w.includes('unknown id'))).toBe(true);
  });

  it('imports clipPath with clip-rule="evenodd"', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <clipPath id="c3" clip-rule="evenodd">
          <path d="M10,10 L90,10 L90,90 L10,90 Z M30,30 L70,30 L70,70 L30,70 Z"/>
        </clipPath>
      </defs>
      <g clip-path="url(#c3)">
        <rect width="100" height="100"/>
      </g>
    </svg>`;
    const result = parseSvg(svg);
    const groupNode = Object.values(result.document.nodes).find(
      (n) => n.kind === 'frame' && n.name === 'Group',
    );
    expect(groupNode!.mask).toBeDefined();
    expect(groupNode!.mask!.fillRule).toBe('evenodd');
  });
});

describe('SVG mask import (D12)', () => {
  it('imports an alpha mask applied to a group', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <mask id="m1">
          <rect width="100" height="100" fill="white"/>
          <circle cx="50" cy="50" r="30" fill="black"/>
        </mask>
      </defs>
      <g mask="url(#m1)">
        <rect width="100" height="100" fill="green"/>
      </g>
    </svg>`;
    const result = parseSvg(svg);
    const groupNode = Object.values(result.document.nodes).find(
      (n) => n.kind === 'frame' && n.name === 'Group',
    );
    expect(groupNode).toBeDefined();
    expect(groupNode!.mask).toBeDefined();
    expect(groupNode!.mask!.type).toBe('alpha');
  });

  it('imports a luminance mask when mask-type="luminance"', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <mask id="m2" mask-type="luminance">
          <rect width="100" height="100" fill="white"/>
        </mask>
      </defs>
      <g mask="url(#m2)">
        <rect width="100" height="100"/>
      </g>
    </svg>`;
    const result = parseSvg(svg);
    const groupNode = Object.values(result.document.nodes).find(
      (n) => n.kind === 'frame' && n.name === 'Group',
    );
    expect(groupNode!.mask).toBeDefined();
    expect(groupNode!.mask!.type).toBe('luminance');
  });

  it('imports a mask applied to a leaf element by wrapping in group', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <mask id="m3">
          <rect width="50" height="100" fill="white"/>
          <rect x="50" width="50" height="100" fill="black"/>
        </mask>
      </defs>
      <rect width="100" height="100" fill="red" mask="url(#m3)"/>
    </svg>`;
    const result = parseSvg(svg);
    const maskedGroup = Object.values(result.document.nodes).find(
      (n) => n.kind === 'frame' && n.name === 'Masked Group',
    );
    expect(maskedGroup).toBeDefined();
    expect(maskedGroup!.mask).toBeDefined();
    expect(maskedGroup!.mask!.type).toBe('alpha');
  });

  it('warns on missing mask reference', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g mask="url(#nonexistent)">
        <rect width="100" height="100"/>
      </g>
    </svg>`;
    const result = parseSvg(svg);
    expect(result.warnings.some((w) => w.includes('unknown id'))).toBe(true);
  });

  it('handles mask with multiple children as group source', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <mask id="m4">
          <rect width="100" height="50" fill="white"/>
          <rect y="50" width="100" height="50" fill="black"/>
        </mask>
      </defs>
      <g mask="url(#m4)">
        <rect width="100" height="100"/>
      </g>
    </svg>`;
    const result = parseSvg(svg);
    const groupNode = Object.values(result.document.nodes).find(
      (n) => n.kind === 'frame' && n.name === 'Group',
    );
    expect(groupNode!.mask).toBeDefined();
    const maskSourceId = groupNode!.mask!.sourceNodeId;
    expect(maskSourceId).toBeDefined();
    const maskSource = result.document.nodes[maskSourceId!];
    expect(maskSource).toBeDefined();
    if (maskSource.kind === 'frame' || maskSource.kind === 'group') {
      expect(maskSource.children.length).toBe(2);
    }
  });
});
