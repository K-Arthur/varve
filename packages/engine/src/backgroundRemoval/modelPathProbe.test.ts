import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A dev server with SPA history fallback answers unknown paths with 200 + HTML.
 * The model-path probe must not read that as "model installed".
 */
const manifestEntry = { value: { localPath: '/models/scunet.onnx', bundled: false } as unknown };
vi.mock('./modelManifest', () => ({
  getManifestEntry: vi.fn(async () => manifestEntry.value),
}));

const LFS_POINTER =
  'version https://git-lfs.github.com/spec/v1\noid sha256:69ba2e3d\nsize 980082799\n';

function lfsPointerResponse() {
  return {
    ok: true,
    headers: new Headers({ 'content-type': '', 'content-length': String(LFS_POINTER.length) }),
    text: async () => LFS_POINTER,
  } as unknown as Response;
}

function htmlResponse() {
  return { ok: true, headers: new Headers({ 'content-type': 'text/html' }) } as Response;
}
function modelResponse() {
  // real .onnx responses often carry an empty/generic content type
  return { ok: true, headers: new Headers({ 'content-type': '' }) } as Response;
}

describe('getModelPath HEAD probe', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    manifestEntry.value = { localPath: '/models/scunet.onnx', bundled: false };
  });

  it('rejects an SPA-fallback HTML response as a missing model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => htmlResponse()),
    );
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('indexedDB', undefined);
    const { getModelLoader } = await import('./modelLoader');
    const path = await getModelLoader().getModelPath('scunet');
    expect(path).toBeNull();
  });

  it('accepts a genuine model response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => modelResponse()),
    );
    const { getModelLoader } = await import('./modelLoader');
    const path = await getModelLoader().getModelPath('scunet');
    expect(path).toBe('/models/scunet.onnx');
  });
});

/**
 * `*.onnx` is Git LFS-tracked, so a checkout without the objects fetched leaves
 * a ~130-byte text stub that serves 200 with a non-HTML type — passing every
 * existence check and failing later as an opaque ONNX parse error.
 */
describe('git LFS pointer detection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('treats an un-fetched LFS stub as a missing model', async () => {
    manifestEntry.value = { localPath: '/models/font-classify.onnx', bundled: false };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => lfsPointerResponse()),
    );
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('indexedDB', undefined);
    const { getModelLoader } = await import('./modelLoader');
    await expect(getModelLoader().getModelPath('font-classify')).resolves.toBeNull();
  });

  it('detects an LFS stub even for a model the manifest calls bundled', async () => {
    manifestEntry.value = { localPath: '/models/ddcolor.onnx', bundled: true };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => lfsPointerResponse()),
    );
    const { getModelLoader } = await import('./modelLoader');
    await expect(getModelLoader().getModelPath('ddcolor')).resolves.toBeNull();
  });

  it('still resolves a genuinely bundled model', async () => {
    manifestEntry.value = { localPath: '/models/u2netp.onnx', bundled: true };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ 'content-type': '', 'content-length': '4574861' }),
        text: async () => 'ONNX binary bytes...',
      })) as unknown as typeof fetch,
    );
    const { getModelLoader } = await import('./modelLoader');
    await expect(getModelLoader().getModelPath('u2netp')).resolves.toBe('/models/u2netp.onnx');
  });
});

/**
 * The download path tries `localPath` before the remote URL. A dev server with
 * SPA fallback answers a missing local model with 200 + HTML, which was then
 * downloaded and reported as "failed SHA-256 verification" — blaming corruption
 * for a file that never existed locally.
 */
describe('download local-first probe', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('falls through to the remote URL when the local path serves SPA HTML', async () => {
    manifestEntry.value = {
      localPath: '/models/scunet_color_real_psnr.onnx',
      bundled: false,
      sha256: 'abc',
      remoteUrl: 'https://example.com/scunet_color_real_psnr.onnx',
      filename: 'scunet_color_real_psnr.onnx',
    };
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(String(url));
        if (String(url).startsWith('/models/')) {
          // SPA fallback: a 200 HTML document for a path that does not exist.
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            body: { cancel: async () => {} },
          } as unknown as Response;
        }
        throw new Error('remote reached');
      }),
    );
    const { getModelLoader, resetModelLoader } = await import('./modelLoader');
    resetModelLoader();
    await getModelLoader()
      .downloadModel('scunet')
      .catch(() => {});

    // It must not have accepted the HTML as the model payload.
    expect(seen.some((u) => u.startsWith('https://example.com/'))).toBe(true);
  });
});
