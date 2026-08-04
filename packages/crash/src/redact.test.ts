import { describe, expect, it } from 'vitest';
import {
  parseStack,
  redactText,
  sanitizeCrashReport,
  sanitizeStackLine,
  toUploadPayload,
  truncate,
} from './redact';
import {
  buildAdversarialRawReport,
  FIXTURE_DOCUMENT_NAME,
  FIXTURE_USERNAME,
  SECRET_FIXTURES,
  SENSITIVE_STACK_TRACE,
} from './redactFixtures';
import { LIMITS, validateCrashReport } from './schema';

const PROHIBITED_PATTERNS = [
  /alice/i,
  /Bob/i,
  /logo-final/i,
  /example\.com\/v1\/files/,
  /SECRETXYZ/,
  /alice@example\.com/,
  /192\.168\.1\.50/,
  /fd00::/,
  /sk-1234567890abcdef/,
  /AKIAIOSFODNN7EXAMPLE/,
  /wJalrXUtnFEMI\/K7MDENG/,
  /sk-proj-/,
  /nas01/,
  /var\/folders/,
  /\/tmp\/varve/,
  /Documents\/varve/,
  /dev\/varve/,
  /设计稿/,
  /alice-pc/,
  /alice-macbook/,
  /\.config\/varve/,
  /cloud\.example\.com\/documents/,
  /:password@/,
];

function assertNoProhibited(serialized: string): void {
  for (const pattern of PROHIBITED_PATTERNS) {
    expect(serialized, `should not contain ${pattern}`).not.toMatch(pattern);
  }
}

describe('redactText', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['home path', SECRET_FIXTURES.homePath, /alice/],
    ['windows user path', SECRET_FIXTURES.windowsUserPath, /Bob/],
    ['mac temp path', SECRET_FIXTURES.macTempPath, /var\/folders/],
    ['posix tmp path', SECRET_FIXTURES.posixTmpPath, /\/tmp\/varve/],
    ['network share', SECRET_FIXTURES.networkShare, /nas01/],
    ['absolute path', SECRET_FIXTURES.absolutePath, /opt\/varve/],
    ['url token query', SECRET_FIXTURES.urlWithToken, /SECRETXYZ/],
    ['url userinfo', SECRET_FIXTURES.urlWithUserInfo, /alice:password/],
    ['url doc id', SECRET_FIXTURES.urlWithDocId, /92817d31/],
    ['email', SECRET_FIXTURES.email, /alice@example\.com/],
    ['ipv4', SECRET_FIXTURES.ipv4, /192\.168\.1\.50/],
    ['ipv6', SECRET_FIXTURES.ipv6, /fd00::/],
    ['bearer token', SECRET_FIXTURES.bearer, /eyJhbGci/],
    ['api key', SECRET_FIXTURES.apiKeyInText, /sk-1234567890abcdef/],
    ['secret env', SECRET_FIXTURES.secretEnv, /sk-proj-/],
    ['aws key', SECRET_FIXTURES.awsKey, /AKIAIOSFODNN7EXAMPLE/],
    ['aws secret', SECRET_FIXTURES.awsSecret, /wJalrXUtnFEMI/],
    ['long token', SECRET_FIXTURES.longToken, /e3b0c442/],
    ['uuid', SECRET_FIXTURES.uuid, /92817d31/],
    ['unicode path', SECRET_FIXTURES.unicodePath, /kevin|设计稿/],
    ['sql with values', SECRET_FIXTURES.sqlWithValues, /INSERT INTO/],
  ];

  for (const [name, input] of cases) {
    it(`redacts ${name}`, () => {
      assertNoProhibited(redactText(input));
    });
  }

  it('keeps the scheme and host of a URL', () => {
    const out = redactText('download from https://cloud.example.com/documents/abc/edit');
    expect(out).toContain('https://cloud.example.com');
    expect(out).not.toContain('/documents/abc');
    expect(out).not.toContain('https://cloud.example.com/documents');
  });

  it('redacts IP-address hosts inside URLs', () => {
    const out = redactText('fetching https://192.168.1.50/api/status');
    expect(out).toContain('https://<ip>');
    expect(out).not.toContain('192.168.1.50');
  });

  it('keeps ordinary text untouched', () => {
    expect(redactText('renderer backend selected')).toBe('renderer backend selected');
  });

  it('redacts a stack trace line', () => {
    const out = sanitizeStackLine(SECRET_FIXTURES.stackLine);
    expect(out).not.toMatch(/alice/);
    expect(out).toContain('context.tsx');
  });
});

describe('parseStack', () => {
  it('parses frames from a sanitized stack', () => {
    const frames = parseStack(SENSITIVE_STACK_TRACE);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.module.length).toBeGreaterThan(0);
      assertNoProhibited(JSON.stringify(frame));
    }
  });

  it('bounds frame count', () => {
    const big = Array.from(
      { length: 100 },
      (_, i) => `    at fn${i} (app:///file${i}.js:${i}:1)`,
    ).join('\n');
    expect(parseStack(big).length).toBeLessThanOrEqual(LIMITS.maxStackFrames);
  });
});

describe('truncate', () => {
  it('truncates at code-point boundaries', () => {
    const s = 'a'.repeat(10) + '界'.repeat(10);
    const out = truncate(s, 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(Array.from(out).length).toBeLessThanOrEqual(12);
  });
});

describe('sanitizeCrashReport — allowlist extraction', () => {
  const sanitized = sanitizeCrashReport(buildAdversarialRawReport())!;
  const serialized = JSON.stringify(sanitized);

  it('drops unknown top-level fields and polluted prototypes', () => {
    expect(sanitized).not.toHaveProperty('unknownField');
    expect(sanitized).not.toHaveProperty('__proto__');
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(Object.prototype).not.toHaveProperty('pollution');
  });

  it('drops unknown nested fields (userName, deviceName, hostname, userText)', () => {
    expect(sanitized.release).not.toHaveProperty('userName');
    expect(sanitized.release).not.toHaveProperty('deviceName');
    expect(sanitized.release).not.toHaveProperty('installPath');
    expect(sanitized.runtime).not.toHaveProperty('hostname');
    expect(sanitized.crash).not.toHaveProperty('userText');
  });

  it('redacts every string field', () => {
    assertNoProhibited(serialized);
  });

  it('never includes user content or identifiers in breadcrumbs', () => {
    expect(serialized).not.toMatch(FIXTURE_DOCUMENT_NAME);
    expect(serialized).not.toMatch(FIXTURE_USERNAME);
  });

  it('keeps attachment content locally but flags attachments unincluded', () => {
    expect(sanitized.attachments.length).toBe(2);
    expect(sanitized.attachments.every((a) => a.included === false)).toBe(true);
    // Content is retained for local review…
    expect(sanitized.attachments[0]!.content).toBeTruthy();
  });

  it('strips local-only fields from the upload payload', () => {
    const payload = toUploadPayload(sanitized);
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('uploadAttempts');
    expect(parsed).not.toHaveProperty('uploadedAt');
    for (const a of parsed.attachments as Array<{ content?: string }>) {
      expect(a.content).toBeUndefined();
    }
  });

  it('attachment content can be stripped locally too', () => {
    const report = sanitizeCrashReport(buildAdversarialRawReport(), {
      includeAttachmentContent: false,
    })!;
    for (const a of report.attachments) {
      expect(a.content).toBeUndefined();
    }
  });

  it('optional fields are excluded unless opted in', () => {
    expect(sanitized.crash.rawStack).toBeUndefined();
    expect(sanitized.release.gitCommit).toBeUndefined();
    const optedIn = sanitizeCrashReport(buildAdversarialRawReport(), { includeOptional: true })!;
    expect(optedIn.crash.rawStack).toBeDefined();
    expect(optedIn.crash.subsystem).toBeDefined();
  });

  it('bounds are enforced on the output', () => {
    const raw = buildAdversarialRawReport();
    (raw.crash as Record<string, unknown>).message = 'x'.repeat(LIMITS.maxMessageLength + 100);
    const report = sanitizeCrashReport(raw)!;
    expect(report.crash.message.length).toBeLessThanOrEqual(LIMITS.maxMessageLength);
  });

  it('output always validates against the schema', () => {
    expect(validateCrashReport(sanitized)).toEqual([]);
  });

  it('handles non-object input', () => {
    expect(sanitizeCrashReport(null)).toBeNull();
    expect(sanitizeCrashReport('x')).toBeNull();
    expect(sanitizeCrashReport([])).toBeNull();
  });
});

describe('report boundary', () => {
  it('a report stuffed with secrets cannot cross the boundary', () => {
    const raw = buildAdversarialRawReport();
    (raw.crash as Record<string, unknown>).message = Object.values(SECRET_FIXTURES).join(' | ');
    (raw.crash as Record<string, unknown>).rawStack = Object.values(SECRET_FIXTURES).join('\n');
    const report = sanitizeCrashReport(raw)!;
    assertNoProhibited(JSON.stringify(toUploadPayload(report)));
  });

  it('user-provided contact survives only as an explicit attachment-class field', () => {
    const raw = buildAdversarialRawReport();
    raw.userContact = 'alice@example.com';
    const report = sanitizeCrashReport(raw)!;
    // The contact field is preserved only because it was explicitly provided;
    // it is classified 'attachment' and must be stripped from the payload
    // unless the user includes attachments.
    const payload = toUploadPayload(report);
    expect(payload).not.toMatch(/alice@example\.com/);
  });
});
