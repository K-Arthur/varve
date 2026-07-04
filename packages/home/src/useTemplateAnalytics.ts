const STORAGE_KEY = 'strata-template-usage';

interface UsageEntry {
  count: number;
  lastUsed: number;
}

function readStore(): Record<string, UsageEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, UsageEntry>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage quota exceeded — silently swallow.
  }
}

export function recordTemplateUsage(templateId: string) {
  const store = readStore();
  const prev = store[templateId];
  store[templateId] = {
    count: (prev?.count ?? 0) + 1,
    lastUsed: Date.now(),
  };
  writeStore(store);
}

export function getMostUsedTemplates<T extends { id: string }>(
  templates: T[],
  count: number,
): T[] {
  const store = readStore();
  const scored = templates
    .filter((t) => {
      const entry = store[t.id];
      return entry !== undefined && entry.count > 0;
    })
    .sort((a, b) => {
      const ca = store[a.id]?.count ?? 0;
      const cb = store[b.id]?.count ?? 0;
      return cb - ca;
    });
  return scored.slice(0, count);
}

export function getRecentTemplates<T extends { id: string }>(
  templates: T[],
  count: number,
): T[] {
  const store = readStore();
  const scored = templates
    .filter((t) => {
      const entry = store[t.id];
      return entry !== undefined && entry.count > 0;
    })
    .sort((a, b) => {
      const eb = store[b.id]?.lastUsed ?? 0;
      const ea = store[a.id]?.lastUsed ?? 0;
      return eb - ea;
    });
  return scored.slice(0, count);
}
