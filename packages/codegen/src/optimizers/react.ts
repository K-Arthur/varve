import type { OptimizationRule } from './types';

const reactRules: OptimizationRule[] = [
  {
    id: 'react-merge-position',
    platform: 'react',
    apply(code: string) {
      const merged = code.replace(
        /style=\{[\s\S]*?position:\s*['"]absolute['"],\s*top:\s*['"]?([0-9.]+)['"]?,\s*left:\s*['"]?([0-9.]+)['"]?[\s\S]*?\}/gs,
        'className="absolute top-[$1px] left-[$2px]"',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'react-merge-size',
    platform: 'react',
    apply(code: string) {
      const merged = code.replace(
        /style=\{[\s\S]*?width:\s*['"]?([0-9.]+[a-z]*)['"]?,\s*height:\s*['"]?([0-9.]+[a-z]*)['"]?[\s\S]*?\}/gs,
        'className={`w-[$1] h-[$2]`}',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'react-inline-to-tailwind-size',
    platform: 'react',
    apply(code: string) {
      const merged = code.replace(
        /style=\{[\s\S]*?width:\s*['"]?(\d+)['"]?,\s*height:\s*['"]?(\d+)['"]?[\s\S]*?\}/gs,
        (match: string, w: string, h: string) => {
          const numW = parseInt(w, 10);
          const numH = parseInt(h, 10);
          const wCls = numW % 4 === 0 ? `w-${numW / 4}` : null;
          const hCls = numH % 4 === 0 ? `h-${numH / 4}` : null;
          if (wCls && hCls) return `className="${wCls} ${hCls}"`;
          return match;
        },
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'react-fragment',
    platform: 'react',
    apply(code: string) {
      const merged = code.replace(/<>\s*([\s\S]*?)\s*<\/>/gs, '<>$1</>');
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'react-self-closing',
    platform: 'react',
    apply(code: string) {
      const merged = code.replace(
        /<([a-zA-Z][a-zA-Z0-9]*)\s*([^>]*?)>\s*<\/\1>/gs,
        (match: string, tag: string, attrs: string) => {
          const trimmed = attrs.trim();
          if (!trimmed.includes('children') && !trimmed.includes('>')) {
            return `<${tag} ${trimmed}/>`;
          }
          return match;
        },
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'react-condense-classname',
    platform: 'react',
    apply(code: string) {
      const merged = code.replace(/className=\{`(.+?)`\}/gs, (match: string, cls: string) => {
        if (!cls.includes('${')) return `className="${cls}"`;
        return match;
      });
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'react-boolean-attr',
    platform: 'react',
    apply(code: string) {
      const merged = code.replace(/\s*([a-zA-Z]+)=\{true\}/gs, ' $1');
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'react-spread-props',
    platform: 'react',
    apply(code: string) {
      const merged = code.replace(
        /style=\{[\s\S]*?display:\s*['"]flex['"],\s*flexDirection:\s*['"]column['"][\s\S]*?\}/gs,
        'className="flex flex-col"',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'react-svg-self-close',
    platform: 'react',
    apply(code: string) {
      const merged = code.replace(/<rect\s+([^>]*)>\s*<\/rect>/gs, '<rect $1/>');
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'react-remove-empty-style',
    platform: 'react',
    apply(code: string) {
      const merged = code.replace(/\s+style=\{[\s]*\}/gs, '');
      return merged !== code ? merged : null;
    },
  },
];

export function optimizeReact(code: string): string | null {
  let result = code;
  let changed = false;
  for (const rule of reactRules) {
    const applied = rule.apply(result, { verbose: false });
    if (applied !== null) {
      result = applied;
      changed = true;
    }
  }
  return changed ? result : null;
}

export default reactRules;
