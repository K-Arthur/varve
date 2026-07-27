import { beforeEach, describe, expect, it } from 'vitest';
import type {
  IconProvider,
  IconProviderIconDetails,
  IconProviderResult,
  IconProviderSearchOptions,
  IconStyle,
} from './iconProviders';
import { IconProviderRegistry } from './iconProviders';

/** Mock provider for testing. */
interface MockProvider extends IconProvider {
  searchResults: IconProviderResult[];
  detailsResult: IconProviderIconDetails | null;
  svgResult: string | null;
}

function createMockProvider(overrides: Partial<MockProvider> = {}): MockProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    kind: 'bundled',
    enabled: true,
    requiresNetwork: false,
    searchResults: [],
    detailsResult: null,
    svgResult: '<svg><path d="M12 2"/></svg>',
    async search(
      _query: string,
      _options?: IconProviderSearchOptions,
    ): Promise<IconProviderResult[]> {
      return this.searchResults;
    },
    async getDetails(_iconId: string): Promise<IconProviderIconDetails | null> {
      return this.detailsResult;
    },
    async getSvg(_iconId: string, _style?: IconStyle): Promise<string | null> {
      return this.svgResult;
    },
    async getPrefixes() {
      return [];
    },
    async getCategories() {
      return [];
    },
    ...overrides,
  } as MockProvider;
}

describe('IconProviderRegistry', () => {
  let registry: IconProviderRegistry;

  beforeEach(() => {
    registry = new IconProviderRegistry();
  });

  it('registers and retrieves providers', () => {
    const provider = createMockProvider();
    registry.register(provider);
    expect(registry.get('mock')).toBe(provider);
  });

  it('returns undefined for unknown provider', () => {
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('unregisters providers', () => {
    const provider = createMockProvider();
    registry.register(provider);
    registry.unregister('mock');
    expect(registry.get('mock')).toBeUndefined();
  });

  it('returns all registered providers', () => {
    registry.register(createMockProvider());
    registry.register(createMockProvider({ id: 'mock2', name: 'Mock 2' }));
    expect(registry.getAll()).toHaveLength(2);
  });

  it('returns only enabled providers', () => {
    const enabled = createMockProvider();
    const disabled = createMockProvider({ id: 'disabled', enabled: false });
    registry.register(enabled);
    registry.register(disabled);
    expect(registry.getEnabled()).toHaveLength(1);
    expect(registry.getEnabled()[0]!.id).toBe('mock');
  });

  it('searches across all enabled providers', async () => {
    const p1 = createMockProvider({
      searchResults: [
        {
          id: 'mock:icon1',
          name: 'icon1',
          prefix: 'mock',
          category: '',
          styles: ['outline'],
          license: {
            name: 'MIT',
            commercial: true,
            modification: true,
            attributionRequired: false,
          },
        },
      ],
    });
    const p2 = createMockProvider({
      id: 'mock2',
      searchResults: [
        {
          id: 'mock2:icon2',
          name: 'icon2',
          prefix: 'mock2',
          category: '',
          styles: ['filled'],
          license: {
            name: 'MIT',
            commercial: true,
            modification: true,
            attributionRequired: false,
          },
        },
      ],
    });
    registry.register(p1);
    registry.register(p2);

    const results = await registry.search('test');
    expect(results).toHaveLength(2);
  });

  it('deduplicates search results by icon ID', async () => {
    const p1 = createMockProvider({
      searchResults: [
        {
          id: 'shared:icon1',
          name: 'icon1',
          prefix: 'shared',
          category: '',
          styles: ['outline'],
          license: {
            name: 'MIT',
            commercial: true,
            modification: true,
            attributionRequired: false,
          },
        },
      ],
    });
    const p2 = createMockProvider({
      id: 'mock2',
      searchResults: [
        {
          id: 'shared:icon1',
          name: 'icon1',
          prefix: 'shared',
          category: '',
          styles: ['outline', 'filled'],
          license: {
            name: 'MIT',
            commercial: true,
            modification: true,
            attributionRequired: false,
          },
        },
      ],
    });
    registry.register(p1);
    registry.register(p2);

    const results = await registry.search('test');
    expect(results).toHaveLength(1);
  });

  it('handles provider failures gracefully', async () => {
    const goodProvider = createMockProvider({
      searchResults: [
        {
          id: 'mock:icon1',
          name: 'icon1',
          prefix: 'mock',
          category: '',
          styles: ['outline'],
          license: {
            name: 'MIT',
            commercial: true,
            modification: true,
            attributionRequired: false,
          },
        },
      ],
    });
    const badProvider = createMockProvider({
      id: 'bad',
      search: async () => {
        throw new Error('Network error');
      },
    });
    registry.register(goodProvider);
    registry.register(badProvider);

    const results = await registry.search('test');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('mock:icon1');
  });

  it('returns empty when no providers enabled', async () => {
    const provider = createMockProvider({ enabled: false });
    registry.register(provider);
    const results = await registry.search('test');
    expect(results).toHaveLength(0);
  });

  it('fetches SVG from the correct provider', async () => {
    const p1 = createMockProvider({ svgResult: '<svg id="p1-svg"/>' });
    const p2 = createMockProvider({ id: 'mock2', svgResult: null });
    registry.register(p1);
    registry.register(p2);

    const svg = await registry.getSvg('mock:icon1');
    expect(svg).toBe('<svg id="p1-svg"/>');
  });
});
