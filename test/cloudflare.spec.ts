import { test, expect, type APIRequestContext } from '@playwright/test';
import { due, redirects } from './content.ts';

const get = async (request: APIRequestContext, path: string) => {
  const res = await request.get(path, { maxRedirects: 0 });
  return { status: res.status(), location: res.headers().location ?? '', robots: res.headers()['x-robots-tag'], text: await res.text() };
};
const target = (location: string) => location.replace(/^https?:\/\/[^/]+/, '');

const cases: [string, string][] = Object.entries(redirects).flatMap(([from, to]): [string, string][] => from.endsWith('/*')
  ? [[from.slice(0, -1), to], [from.slice(0, -2), to], [from.slice(0, -1) + 'anything/', to]]
  : [[from, to], [from.slice(0, -1), to]]);
for (const [from, to] of cases) {
  test(`${from} redirects to ${to}`, async ({ request }) => {
    const slugs = new Set((await due(request)).map((a) => a.slug));
    const expected = to === '/' || slugs.has(to.replace(/^\/|\/$/g, '')) ? to : '/';
    const { status, location } = await get(request, from);
    expect(status).toBe(301);
    expect(target(location)).toBe(expected);
  });
}

test('an old article path redirects to the article', async ({ request }) => {
  const { slug } = (await due(request))[0];
  for (const from of [`/blog/engineering/${slug}/`, `/blog/engineering/${slug}`]) {
    const { status, location } = await get(request, from);
    expect(status, from).toBe(301);
    expect(target(location), from).toBe(`/${slug}/`);
  }
});

test('an article without its trailing slash gets one', async ({ request }) => {
  const { slug } = (await due(request))[0];
  const { status, location } = await get(request, `/${slug}`);
  expect([301, 307, 308]).toContain(status);
  expect(target(location)).toBe(`/${slug}/`);
});

test('a missing page is the 404 page, with status 404', async ({ request }) => {
  const { status, text } = await get(request, '/no-such-page/');
  expect(status).toBe(404);
  if (!process.env.BASE_URL) expect(text).toContain("This page doesn't exist.");
});

test('the redirect and header files are read, not served', async ({ request }) => {
  expect((await get(request, '/_redirects')).status).toBe(404);
  expect((await get(request, '/_headers')).status).toBe(404);
});

test('noindex on every response of a preview, never in production', async ({ request }) => {
  const { slug } = (await due(request))[0];
  for (const path of ['/', `/${slug}/`, `/${slug}.md`, '/no-such-page/']) {
    expect((await get(request, path)).robots, path).toBe(process.env.PREVIEW ? 'noindex' : undefined);
  }
});

test.describe('the newsletter API', () => {
  test.skip(!process.env.BASE_URL, 'the Worker runs only on Cloudflare');
  test('refuses a wrong address and a wrong method, and sends a bad link to /link-expired/', async ({ request }) => {
    expect((await request.get('/api/subscribe', { maxRedirects: 0 })).status()).toBe(405);
    expect((await request.post('/api/subscribe', { data: { email: 'not an address' } })).status()).toBe(400);
    const bad = await get(request, '/api/confirm?e=a%40b.co&t=1&s=forged');
    expect(bad.status).toBe(303);
    expect(target(bad.location)).toBe('/link-expired/');
    expect((await get(request, '/api/nope')).status).toBe(404);
  });
});
