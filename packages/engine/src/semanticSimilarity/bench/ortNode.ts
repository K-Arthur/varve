/**
 * Dev-only ONNX Runtime Node wrapper for the semantic-similarity bench
 * harness. Uses the native ORT build (`onnxruntime-node`, devDependency)
 * as the independent counterpart to the production `onnxruntime-web`
 * worker path; the parity test ties the two together.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface OrtTensor {
  data: Float32Array;
  dims: number[];
}

export interface NodeFeed {
  type?: 'float32' | 'int64';
  data: Float32Array | BigInt64Array;
  dims: number[];
}

interface OrtSessionLike {
  run(feeds: Record<string, NodeFeed>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
}

interface OrtTensorConstructor {
  new (type: string, data: Float32Array | BigInt64Array, dims: number[]): unknown;
}

interface OrtNodeModule {
  InferenceSession: {
    create: (
      path: string,
      opts: { executionProviders: string[] },
    ) => Promise<{
      run: (feeds: Record<string, unknown>) => Promise<Record<string, OrtTensor>>;
      release: () => Promise<void>;
    }>;
  };
  Tensor: OrtTensorConstructor;
}

const sessionCache = new Map<string, OrtSessionLike>();
let ortModule: OrtNodeModule | null = null;

async function getOrt(): Promise<OrtNodeModule> {
  if (!ortModule) {
    ortModule = require('onnxruntime-node') as OrtNodeModule;
  }
  return ortModule;
}

export async function loadNodeOrtSession(modelPath: string): Promise<OrtSessionLike> {
  const cached = sessionCache.get(modelPath);
  if (cached) return cached;
  const ort = await getOrt();
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
  });
  const wrapper: OrtSessionLike = {
    run: (feeds) => {
      const tensorFeeds: Record<string, unknown> = {};
      for (const [name, feed] of Object.entries(feeds)) {
        tensorFeeds[name] = new ort.Tensor(feed.type ?? 'float32', feed.data, feed.dims);
      }
      return session.run(tensorFeeds);
    },
    release: () => session.release(),
  };
  sessionCache.set(modelPath, wrapper);
  return wrapper;
}

export async function releaseNodeOrtSessions(): Promise<void> {
  for (const session of sessionCache.values()) {
    try {
      await session.release();
    } catch {
      // best effort
    }
  }
  sessionCache.clear();
}

/** int64 feed for graphs with required non-image inputs. */
export function int64Zeros(dims: number[]): NodeFeed {
  const count = dims.reduce((a, b) => a * b, 1);
  return { type: 'int64', data: new BigInt64Array(count), dims };
}

export type { OrtSessionLike, OrtTensor };
