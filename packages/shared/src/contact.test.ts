import { describe, expect, it } from 'vitest';
import {
  CONTACT_CHANNELS,
  CONTACT_DOMAIN,
  CONTACTS,
  type ContactChannelId,
  contactChannel,
  contactMailto,
  VARVE_URLS,
} from './contact';

/**
 * Contact-identity guards.
 *
 * These tests exist because a contact system fails in two specific ways:
 * a private routing mailbox leaks into a public artifact, or the surfaces
 * drift apart so a reader cannot tell which channel to use. Both are cheap
 * to assert and expensive to discover in production.
 */
describe('public contact identities', () => {
  const ids = Object.keys(CONTACTS) as ContactChannelId[];

  it('publishes exactly the seven canonical roles', () => {
    expect(ids.sort()).toEqual([
      'feedback',
      'general',
      'partnerships',
      'press',
      'privacy',
      'security',
      'support',
    ]);
  });

  it('routes every public address through the varve.studio domain', () => {
    for (const email of Object.values(CONTACTS)) {
      expect(email).toMatch(/^[a-z]+@varve\.studio$/);
      expect(email.endsWith(`@${CONTACT_DOMAIN}`)).toBe(true);
    }
  });

  it('never exposes a consumer mailbox or a retired-brand address', () => {
    const serialized = JSON.stringify({ CONTACTS, CONTACT_CHANNELS, VARVE_URLS });
    // The inbound forwarding destination is administrative configuration.
    // If it ever appears in this module it reaches the website and the app.
    expect(serialized).not.toMatch(/gmail|googlemail|outlook|yahoo|proton/i);
    // Strata was the pre-2026-08-04 product name; no active contact
    // identity may still carry it.
    expect(serialized.toLowerCase()).not.toContain('strata');
  });

  it('describes every address exactly once, in a stable order', () => {
    expect(CONTACT_CHANNELS.map((c) => c.id)).toEqual([
      'general',
      'support',
      'feedback',
      'security',
      'privacy',
      'press',
      'partnerships',
    ]);
    expect(new Set(CONTACT_CHANNELS.map((c) => c.email)).size).toBe(ids.length);
  });

  it('gives every channel a purpose and a distinguishing link label', () => {
    for (const channel of CONTACT_CHANNELS) {
      expect(channel.email).toBe(CONTACTS[channel.id]);
      expect(channel.purpose.length).toBeGreaterThan(20);
      expect(channel.examples.length).toBeGreaterThan(0);
      // "Email us" tells a screen-reader user nothing when several mail
      // links are read out of context.
      expect(channel.linkLabel.toLowerCase()).not.toBe('email us');
      expect(channel.linkLabel).toMatch(/Varve/);
    }
  });

  it('resolves channels by id', () => {
    expect(contactChannel('security').email).toBe('security@varve.studio');
    expect(() => contactChannel('nope' as ContactChannelId)).toThrow();
  });
});

describe('contactMailto', () => {
  it('encodes a short static subject', () => {
    expect(contactMailto('support')).toBe('mailto:support@varve.studio?subject=Varve%20support');
  });

  it('supports omitting the subject entirely', () => {
    expect(contactMailto('general', { subject: false })).toBe('mailto:hello@varve.studio');
  });

  it('keeps mail URLs free of body payloads', () => {
    for (const channel of CONTACT_CHANNELS) {
      const url = contactMailto(channel.id);
      expect(url).not.toContain('&body=');
      expect(url).not.toContain('?body=');
      // A subject long enough to hold diagnostics is a leak waiting to happen.
      expect(url.length).toBeLessThan(120);
    }
  });
});

describe('VARVE_URLS', () => {
  it('points every canonical URL at owned Varve infrastructure', () => {
    for (const url of Object.values(VARVE_URLS)) {
      expect(url).toMatch(/^https:\/\/(varve\.studio|github\.com\/K-Arthur\/varve)/);
    }
  });

  it('exposes the canonical contact and security-txt locations', () => {
    expect(VARVE_URLS.contact).toBe('https://varve.studio/contact');
    expect(VARVE_URLS.securityTxt).toBe('https://varve.studio/.well-known/security.txt');
  });
});
