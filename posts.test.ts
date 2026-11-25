import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkedinPosts, readReleases } from './posts.ts';
import type { Fetch } from './posts.ts';

const release = (created_at: string, articles: unknown[]) => ({ created_at, body: `List.\n\n<!-- record\n${JSON.stringify({ articles })}\n-->\n` });

test('every LinkedIn post a release holds, the newer release winning', () => {
  const posts = linkedinPosts([
    release('2026-12-01T08:00:00Z', [{ slug: 'a', channels: { linkedin: 'https://www.linkedin.com/posts/new' } }]),
    release('2026-11-24T08:00:00Z', [
      { slug: 'a', channels: { linkedin: 'https://www.linkedin.com/posts/old' } },
      { slug: 'b', channels: { linkedin: 'https://www.linkedin.com/feed/update/b/', newsletter: 'sent' } },
    ]),
  ]);
  assert.deepEqual(posts, { a: 'https://www.linkedin.com/posts/new', b: 'https://www.linkedin.com/feed/update/b/' });
});

test('nothing for a pending post, another channel, a link elsewhere or a release without a record', () => {
  assert.deepEqual(linkedinPosts([
    release('2026-11-24T08:00:00Z', [
      { slug: 'pending', channels: { linkedin: null } },
      { slug: 'devto', channels: { devto: 'https://dev.to/x' } },
      { slug: 'elsewhere', channels: { linkedin: 'https://example.com/x' } },
    ]),
    { created_at: '2026-11-20T08:00:00Z', body: 'Cut by hand.' },
    { created_at: '2026-11-19T08:00:00Z', body: null },
  ]), {});
});

test('releases from GitHub, page by page, with the token', async () => {
  const seen: [string, string][] = [];
  const fetch: Fetch = async (url, { headers }) => {
    seen.push([url, headers.Authorization]);
    const next = url.endsWith('per_page=100') ? '<https://api.test/p2>; rel="next"' : null;
    return { ok: true, status: 200, text: async () => '', json: async () => [{ tag_name: url }], headers: { get: () => next } };
  };
  const out = await readReleases('/nowhere', { token: 't', repo: 'o/r', fetch });
  assert.equal(out.length, 2);
  assert.deepEqual(seen.map((s) => s[1]), ['Bearer t', 'Bearer t']);
  await assert.rejects(readReleases('/nowhere', { token: 't', repo: 'o/r', fetch: async () => ({ ok: false, status: 403, text: async () => 'no', json: async () => [], headers: { get: () => null } }) }), /403/);
});

test('no token and no stand-in file: no releases', async () => {
  assert.deepEqual(await readReleases('/nowhere', { token: '', repo: '' }), []);
});
