/**
 * Realistic sensitive fixtures for privacy tests.
 *
 * Every string here models data the system must never transmit (Phase 5:
 * redaction fixtures). Tests assert that none of these values — nor any
 * substring that would identify a user — can cross the sanitization and
 * upload boundaries.
 */

export const FIXTURE_USERNAME = 'alice';
export const FIXTURE_DOCUMENT_NAME = 'logo-final';

export const SECRET_FIXTURES = {
  homePath: '/home/alice/Documents/varve/logo-final.strata',
  homePathNoDoc: '/home/alice/.config/varve/settings.json',
  windowsUserPath: 'C:\\Users\\Bob\\AppData\\Local\\Temp\\varve\\dump\\heap.json',
  macTempPath: '/var/folders/x1/y2abcdefghij/T/varve-crash-9384',
  posixTmpPath: '/tmp/varve-render-worker-2938.log',
  networkShare: '\\\\nas01\\share\\projects\\brand\\assets\\hero.png',
  absolutePath: '/opt/varve/current/resources/app.asar',
  urlWithToken: 'https://api.example.com/v1/files/abc123?token=SECRETXYZ&user=alice',
  urlWithUserInfo: 'https://alice:password@example.com/private/design',
  urlWithDocId: 'https://cloud.example.com/documents/92817d31-9c04-4a9b-9d36-3b7f9c3e9b1a/edit',
  email: 'alice@example.com',
  ipv4: '192.168.1.50',
  ipv6: 'fd00::a1b2:c3d4:5e6f:7089',
  bearer:
    'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
  apiKeyInText: 'api_key=sk-1234567890abcdef',
  secretEnv: 'VARVE_BG_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
  awsKey: 'AKIAIOSFODNN7EXAMPLE',
  awsSecret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  longToken: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  uuid: '92817d31-9c04-4a9b-9d36-3b7f9c3e9b1a',
  unicodePath: '/home/kevin/Documents/设计稿-最终版.strata',
  stackLine: 'at /home/alice/dev/varve/packages/editor/src/context.tsx:7243:15',
  sqlWithValues: "INSERT INTO documents (id) VALUES ('abc123') VALUES user content",
} as const;

export const SENSITIVE_FIXTURE_VALUES: string[] = [
  ...Object.values(SECRET_FIXTURES),
  FIXTURE_USERNAME,
  FIXTURE_DOCUMENT_NAME,
];

/** A realistic raw stack trace containing user-identifying content. */
export const SENSITIVE_STACK_TRACE = [
  'Error: rendering failed',
  '    at renderSubtree (/home/alice/dev/varve/packages/editor/src/CanvasArea.tsx:1031:5)',
  '    at drawFrame (/home/alice/dev/varve/packages/engine/src/replay.ts:87:11)',
  '    at <anonymous> (https://api.example.com/v1/trace?user=alice&token=SECRETXYZ)',
  '    at Worker.onmessage (/tmp/varve-render-worker-2938.js:42:9)',
  '    at alice@example.com',
  '    at 192.168.1.50:8080/heartbeat',
].join('\n');

/** A raw untrusted report object with prohibited and unknown content. */
export function buildAdversarialRawReport(): Record<string, unknown> {
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    reportId: 'r-raw-1',
    sessionId: 's-raw-1',
    createdAt: 1700000000000,
    release: {
      appVersion: '0.1.0',
      buildChannel: 'production',
      releaseId: 'rel-1',
      documentSchemaVersion: 3,
      // Prohibited: personalization attempt
      userName: FIXTURE_USERNAME,
      deviceName: 'alice-macbook-pro',
      installPath: SECRET_FIXTURES.absolutePath,
    },
    runtime: {
      runtime: 'tauri',
      osFamily: 'linux',
      osVersionRange: '6.0+',
      arch: 'x64',
      memoryPressure: 'medium',
      rendererBackend: 'canvas2d',
      hostname: 'alice-pc',
    },
    crash: {
      type: 'error',
      category: 'render-loop',
      subsystem: 'canvas',
      message: `failed at ${SECRET_FIXTURES.homePath}`,
      stack: SENSITIVE_STACK_TRACE,
      rawStack: SENSITIVE_STACK_TRACE,
      threadCategory: 'main',
      userText: 'my secret layer name',
    },
    breadcrumbs: [
      { ts: 1, event: 'document.open.started', category: 'document' },
      { ts: 2, event: `opened ${SECRET_FIXTURES.urlWithDocId}`, category: 'file' },
      { ts: 3, event: `layer renamed to ${FIXTURE_DOCUMENT_NAME}`, category: 'layer' },
      {
        ts: 4,
        event: 'command.failed',
        category: 'command',
        payload: { documentName: 'logo-final' },
      },
    ],
    attachments: [
      {
        // Capture layer always uses opaque attachment names — never the
        // document name (logo-final) or the username.
        kind: 'screenshot',
        name: 'varve-screenshot-1.png',
        sizeBytes: 1024,
        content: 'base64-screenshot-bytes',
        included: false,
      },
      {
        kind: 'log',
        name: 'varve-log.txt',
        sizeBytes: 2048,
        content: `${SECRET_FIXTURES.email}\n${SECRET_FIXTURES.windowsUserPath}`,
        included: false,
      },
    ],
    userComment: `see ${SECRET_FIXTURES.email}`,
    userContact: SECRET_FIXTURES.email,
    consentPolicyVersion: 1,
    recoveryStatus: 'not-applicable',
    uploadAttempts: 3,
    uploadedAt: 1700000001000,
    constructor: { prototype: { polluted: true } },
    unknownField: 'should-be-dropped',
  };
  // Simulates a JSON.parse'd payload with a `__proto__` key: an own enumerable
  // property, not an object-literal prototype assignment.
  Object.defineProperty(report, '__proto__', {
    value: { pollution: true },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return report;
}
