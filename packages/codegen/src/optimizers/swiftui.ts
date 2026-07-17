import type { OptimizationRule } from './types';

const swiftuiRules: OptimizationRule[] = [
  {
    id: 'swiftui-merge-frame-position',
    platform: 'swiftui',
    apply(code: string) {
      const merged = code.replace(
        /\.frame\(\s*width:\s*([0-9.]+),\s*height:\s*([0-9.]+)\s*\)\s*\.position\(\s*x:\s*([0-9.]+),\s*y:\s*([0-9.]+)\s*\)/gs,
        '.frame(width: $1, height: $2).position(x: $3, y: $4)',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'swiftui-merge-modifiers',
    platform: 'swiftui',
    apply(code: string) {
      const merged = code.replace(
        /\.foregroundColor\((.+?)\)\s*\.font\((.+?)\)/gs,
        '.foregroundColor($1).font($2)',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'swiftui-semantic-color',
    platform: 'swiftui',
    apply(code: string) {
      const merged = code.replace(
        /Color\(\s*hex:\s*"#([0-9a-fA-F]{6})"\s*\)/gs,
        (_match: string, hex: string) => {
          return `Color(red: ${parseInt(hex.substring(0, 2), 16) / 255}, green: ${parseInt(hex.substring(2, 4), 16) / 255}, blue: ${parseInt(hex.substring(4, 6), 16) / 255})`;
        },
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'swiftui-single-modifier-line',
    platform: 'swiftui',
    apply(code: string) {
      const merged = code.replace(/\n\s+\./g, '\n  .');
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'swiftui-remove-redundant-frame',
    platform: 'swiftui',
    apply(code: string) {
      const merged = code.replace(/\.frame\(\)/gs, '');
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'swiftui-padding-edge',
    platform: 'swiftui',
    apply(code: string) {
      const merged = code.replace(/\.padding\(\.all,\s*([0-9.]+)\)/gs, '.padding($1)');
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'swiftui-clip-shape',
    platform: 'swiftui',
    apply(code: string) {
      const merged = code.replace(
        /\.clipShape\(RoundedRectangle\(cornerRadius:\s*([0-9.]+)\)\)/gs,
        '.cornerRadius($1)',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'swiftui-background-simplify',
    platform: 'swiftui',
    apply(code: string) {
      const merged = code.replace(/\.background\(\s*Color\((.+?)\)\s*\)/gs, '.background($1)');
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'swiftui-image-resizing',
    platform: 'swiftui',
    apply(code: string) {
      const merged = code.replace(
        /\.resizable\(\)\s*\.aspectRatio\(contentMode:\s*\.fit\)/gs,
        '.resizable().aspectRatio(contentMode: .fit)',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'swiftui-navigation-title',
    platform: 'swiftui',
    apply(code: string) {
      const merged = code.replace(/\.navigationBarTitle\((.+?)\)/gs, '.navigationTitle($1)');
      return merged !== code ? merged : null;
    },
  },
];

export function optimizeSwiftUI(code: string): string | null {
  let result = code;
  let changed = false;
  for (const rule of swiftuiRules) {
    const applied = rule.apply(result, { verbose: false });
    if (applied !== null) {
      result = applied;
      changed = true;
    }
  }
  return changed ? result : null;
}

export default swiftuiRules;
