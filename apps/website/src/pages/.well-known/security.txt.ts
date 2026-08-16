import { CONTACTS } from '@varve/shared';
import type { APIRoute } from 'astro';
import { siteUrl } from '../../lib/siteUrl';

export const GET: APIRoute = () => {
  const body = [
    `Contact: mailto:${CONTACTS.security}`,
    `Canonical: ${siteUrl('/.well-known/security.txt')}`,
    `Policy: ${siteUrl('/security')}`,
    'Preferred-Languages: en',
    'Expires: 2027-08-15T00:00:00Z',
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
