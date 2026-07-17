import type { OptimizationRule } from './types';

const flutterRules: OptimizationRule[] = [
  {
    id: 'flutter-merge-positioned-container',
    platform: 'flutter',
    apply(code: string) {
      const merged = code.replace(
        /Positioned\(\s*top:\s*([0-9.]+),\s*left:\s*([0-9.]+),\s*child:\s*Container\(\s*(.+?)\s*\)\s*\)/gs,
        'Positioned.fill(top: $1, left: $2, child: Container($3))',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'flutter-colored-box',
    platform: 'flutter',
    apply(code: string) {
      const merged = code.replace(
        /Container\(\s*color:\s*(.+?),\s*child:\s*(.+?)\s*\)\s*/gs,
        'ColoredBox(color: $1, child: $2)',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'flutter-consecutive-padding',
    platform: 'flutter',
    apply(code: string) {
      const merged = code.replace(
        /Padding\(\s*padding:\s*(\S+),\s*child:\s*Padding\(\s*padding:\s*(\S+),\s*child:\s*(.+?)\s*\)\s*\)/gs,
        'Padding(padding: $1 + $2, child: $3)',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'flutter-shrink',
    platform: 'flutter',
    apply(code: string) {
      const merged = code.replace(
        /SizedBox\(\s*width:\s*0,\s*height:\s*0\s*\)/gs,
        'SizedBox.shrink()',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'flutter-expanded-single-child',
    platform: 'flutter',
    apply(code: string) {
      const merged = code.replace(/Expanded\(\s*child:\s*(.+?)\s*\)/gs, 'Expanded(child: $1)');
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'flutter-simplify-edge-insets',
    platform: 'flutter',
    apply(code: string) {
      const merged = code.replace(
        /EdgeInsets\.only\(\s*left:\s*([0-9.]+),\s*top:\s*\1,\s*right:\s*\1,\s*bottom:\s*\1\s*\)/gs,
        'EdgeInsets.all($1)',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'flutter-align-fill',
    platform: 'flutter',
    apply(code: string) {
      const merged = code.replace(
        /Align\(\s*alignment:\s*Alignment\.center,\s*child:\s*FractionallySizedBox\(\s*widthFactor:\s*1,\s*heightFactor:\s*1,\s*child:\s*(.+?)\s*\)\s*\)/gs,
        'Center(child: $1)',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'flutter-single-child-row-col',
    platform: 'flutter',
    apply(code: string) {
      const merged = code.replace(
        /(Row|Column)\(\s*children:\s*\[\s*(.+?)\s*\]\s*\)/gs,
        (match: string, _widget: string, child: string) => {
          const trimmed = child.trim();
          if (trimmed.length > 0 && !trimmed.includes(',')) {
            return `$1(child: ${trimmed})`;
          }
          return match;
        },
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'flutter-remove-unnecessary-flex',
    platform: 'flutter',
    apply(code: string) {
      const merged = code.replace(
        /Flex\(\s*direction:\s*Axis\.horizontal,\s*children:\s*\[(.+?)\]\s*\)/gs,
        'Row(children: [$1])',
      );
      return merged !== code ? merged : null;
    },
  },
  {
    id: 'flutter-const-constructor',
    platform: 'flutter',
    apply(code: string) {
      const merged = code.replace(
        /(SizedBox|Padding|Center|ColoredBox|SizedBox\.shrink)\(/gs,
        'const $1(',
      );
      return merged !== code ? merged : null;
    },
  },
];

export function optimizeFlutter(code: string): string | null {
  let result = code;
  let changed = false;
  for (const rule of flutterRules) {
    const applied = rule.apply(result, { verbose: false });
    if (applied !== null) {
      result = applied;
      changed = true;
    }
  }
  return changed ? result : null;
}

export default flutterRules;
