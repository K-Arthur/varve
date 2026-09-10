/**
 * 2.14 → 2.15 migration: typed variable modifiers (+ table node scaffolding).
 *
 * `PropertyBinding.modifiers` is a new optional array of typed records
 * (alpha first). Old documents load unchanged; malformed serialized modifier
 * data is dropped so every reader can assume well-typed values.
 */
import { validateVariableModifiers } from './modifiers';

export function migrateV214ToV215(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw, formatVersion: '2.15' } as Record<string, unknown>;
  const nodes = result.nodes as Record<string, unknown> | undefined;
  if (nodes) {
    for (const node of Object.values(nodes)) {
      if (!node || typeof node !== 'object') continue;
      const n = node as Record<string, unknown>;
      const bindings = n.bindings;
      if (!bindings || typeof bindings !== 'object') continue;
      for (const binding of Object.values(bindings as Record<string, unknown>)) {
        if (!binding || typeof binding !== 'object') continue;
        const b = binding as Record<string, unknown>;
        if (b.modifiers === undefined) continue;
        b.modifiers = validateVariableModifiers(b.modifiers);
      }
    }
  }
  return result;
}
