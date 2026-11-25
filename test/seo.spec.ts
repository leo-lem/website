import { test, expect, type APIRequestContext } from '@playwright/test';

const SITE = 'https://leolem.dev';
const get = async (request: APIRequestContext, path: string) => {
  const res = await request.get(path, { maxRedirects: 0 });
  return { status: res.status(), headers: res.headers(), text: await res.text() };
};
const one = (html: string, re: RegExp) => {
  const all = [...html.matchAll(new RegExp(re.source, 'g'))];
  expect(all, String(re)).toHaveLength(1);
  return all[0][1];
};
const meta = (html: string, attr: 'name' | 'property', key: string) => one(html, new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`));
const ld = (html: string) => JSON.parse(one(html, /<script type="application\/ld\+json">(.*?)<\/script>/));

async function articles(request: APIRequestContext) {
  const { text } = await get(request, '/sitemap.xml');
  return [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE, '')).filter((p) => p !== '/');
}

test('home page: canonical, description, previews and a Person', async ({ request }) => {
  const { status, text } = await get(request, '/');
  expect(status).toBe(200);
  expect(one(text, /<link rel="canonical" href="([^"]*)">/)).toBe(`${SITE}/`);
  expect(meta(text, 'name', 'description').length).toBeGreaterThan(50);
  expect(meta(text, 'property', 'og:type')).toBe('profile');
  expect(meta(text, 'property', 'og:image')).toMatch(/^https:\/\/leolem\.dev\//);
  const person = ld(text);
  expect(person['@type']).toBe('Person');
  expect(person.name).toBe('Leopold Lemmermann');
  expect(person.sameAs.length).toBeGreaterThan(0);
});

test('every article: canonical, description, previews, a BlogPosting and its Markdown', async ({ request }) => {
  const paths = await articles(request);
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) {
    expect(path, 'articles live at /<slug>/').toMatch(/^\/[a-z0-9-]+\/$/);
    const { status, text } = await get(request, path);
    expect(status, path).toBe(200);
    expect(one(text, /<link rel="canonical" href="([^"]*)">/)).toBe(SITE + path);
    expect(meta(text, 'name', 'description').trim().length, path).toBeGreaterThan(0);
    expect(meta(text, 'property', 'og:type')).toBe('article');
    expect(meta(text, 'name', 'twitter:card')).toBe('summary_large_image');
    const post = ld(text);
    expect(post['@type']).toBe('BlogPosting');
    expect(post.url).toBe(SITE + path);
    expect(post.author.name.length).toBeGreaterThan(0);
    expect(post.dateModified >= post.datePublished, path).toBe(true);
    expect(post.keywords, 'no tags on the site').toBeUndefined();
    const md = await get(request, path.slice(0, -1) + '.md');
    expect(md.status, path).toBe(200);
    expect(md.text.startsWith(`# ${post.headline}\n`), path).toBe(true);
  }
});

test('an article without its trailing slash redirects to it', async ({ request }) => {
  const [path] = await articles(request);
  const { status, headers } = await get(request, path.slice(0, -1));
  expect(status).toBe(301);
  expect(headers.location).toBe(path);
});

test('a page reached with a query string is kept out of the index', async ({ request }) => {
  const { text } = await get(request, '/?ref=x');
  expect(text).toContain(`if (location.search) document.write('<meta name="robots" content="noindex,follow">');`);
});

test('robots.txt allows every crawler and points to the sitemap', async ({ request }) => {
  const { text } = await get(request, '/robots.txt');
  expect(text).toContain('User-agent: *\nAllow: /');
  expect(text).not.toContain('Disallow');
  expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
});

test('llms.txt lists every article as Markdown', async ({ request }) => {
  const { status, text } = await get(request, '/llms.txt');
  expect(status).toBe(200);
  expect(text.startsWith('# Leopold Lemmermann\n\n> ')).toBe(true);
  for (const path of await articles(request)) expect(text).toContain(`(${SITE}${path.slice(0, -1)}.md)`);
});
