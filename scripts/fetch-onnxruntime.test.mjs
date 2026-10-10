#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadToBuffer,
  isRetryableDownloadError,
  isRetryableHttpStatus,
} from './fetch-onnxruntime.mjs';

function connectTimeoutError() {
  const error = new TypeError('fetch failed');
  error.cause = Object.assign(new Error('Connect Timeout Error'), {
    name: 'ConnectTimeoutError',
    code: 'UND_ERR_CONNECT_TIMEOUT',
  });
  return error;
}

function httpResponse(status, body = 'ok', headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(headers),
    text: async () => body,
    arrayBuffer: async () => Buffer.from(body),
  };
}

test('connect timeouts from undici are retryable download errors', () => {
  assert.equal(isRetryableDownloadError(connectTimeoutError()), true);
  assert.equal(isRetryableDownloadError(new Error('checksum mismatch')), false);
  assert.equal(isRetryableHttpStatus(503), true);
  assert.equal(isRetryableHttpStatus(404), false);
});

test('downloadToBuffer retries a GitHub connect timeout and then succeeds', async () => {
  const bodies = ['onnx-bytes'];
  let calls = 0;
  const retries = [];
  const buffer = await downloadToBuffer(
    'https://github.com/microsoft/onnxruntime/releases/download/v1.27.1/onnxruntime-linux-x64-1.27.1.tgz',
    {
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw connectTimeoutError();
        return httpResponse(200, bodies[0], { 'content-length': String(bodies[0].length) });
      },
      sleep: async () => {},
      onRetry: (event) => retries.push(event),
    },
  );

  assert.equal(calls, 2);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].kind, 'UND_ERR_CONNECT_TIMEOUT');
  assert.equal(buffer.toString(), 'onnx-bytes');
});

test('downloadToBuffer retries a transient HTTP 503 then succeeds', async () => {
  const responses = [httpResponse(503, 'busy'), httpResponse(200, 'staged')];
  let calls = 0;
  const buffer = await downloadToBuffer('https://example.test/ort.tgz', {
    fetchImpl: async () => {
      calls += 1;
      return responses.shift();
    },
    sleep: async () => {},
    onRetry: () => {},
  });
  assert.equal(calls, 2);
  assert.equal(buffer.toString(), 'staged');
});

test('downloadToBuffer does not retry a 404', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      downloadToBuffer('https://example.test/missing.tgz', {
        fetchImpl: async () => {
          calls += 1;
          return httpResponse(404, 'nope');
        },
        sleep: async () => assert.fail('must not sleep on 404'),
        onRetry: () => assert.fail('must not retry 404'),
      }),
    /HTTP 404/,
  );
  assert.equal(calls, 1);
});
