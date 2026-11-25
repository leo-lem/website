import { test, expect, type APIRequestContext } from '@playwright/test';
import { all, due, posts } from './content.ts';

const get = async (request: APIRequestContext, p: string) => {
  const r = await request.get(p, { maxRedirects: 0 });
  return { status: r.status(), text: await r.text(), type: r.headers()['content-type'] || '' };
};
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

test('home lists the three newest due articles, newest first, each linking to its page', async ({ request }) => {
  const home = (await get(request, '/')).text, newest = (await due(request)).slice(0, 3);
  const list = home.match(/<div class="list">([\s\S]*?)<\/div>/)![1];
  const items = [...list.matchAll(/<a href="\/([a-z0-9-]+)\/"[^>]*><b>([\s\S]*?)<\/b><span>([^<]+)<\/span><\/a>/g)];
  expect(items.map((m) => m[1])).toEqual(newest.map((a) => a.slug));
  items.forEach((m, i) => {
    expect(textOf(m[2]).replace(/\s*→$/, '')).toBe(newest[i].title);
    expect(m[3]).toBe(newest[i].date);
  });
});

test('every due article has its page: title, summary, date, body and marked links', async ({ request }) => {
  const list = await due(request), out = new Set(list.map((a) => a.slug));
  expect(list.length).toBeGreaterThan(0);
  for (const a of list) {
    const { status, text } = await get(request, `/${a.slug}/`);
    expect(status, a.slug).toBe(200);
    expect(textOf(text.match(/<h1>([\s\S]*?)<\/h1>/)![1]), a.slug).toBe(a.title);
    expect(text, a.slug).toMatch(/<p class="sum">[^<]{20,}<\/p>/);
    expect(text, a.slug).toMatch(/<p class="kick">\d{1,2} [A-Z][a-z]+ \d{4} · \d+ min read<\/p>/);
    expect(text, a.slug).toMatch(/"timeRequired":"PT\d+M"/);
    expect((text.match(/<section class="blk/g) || []).length, `${a.slug}: body`).toBeGreaterThan(0);
    for (const s of a.links.filter((s) => s !== a.slug && all.some((b) => b.slug === s))) {
      if (out.has(s)) expect(text, `${a.slug} -> ${s}`).toMatch(new RegExp(`<a href="/${s}/[^"]*" class="alink">`));
      else expect(text, `${a.slug} -> ${s}, not out yet`).not.toContain(`href="/${s}/`);
    }
  }
});

test('an article that went out on LinkedIn ends with a link to the discussion there, in its Markdown too', async ({ request }) => {
  const list = await due(request), held = await posts();
  for (const a of list) {
    const page = (await get(request, `/${a.slug}/`)).text, mdText = (await get(request, `/${a.slug}.md`)).text;
    const link = page.match(/<a class="disc" href="([^"]+)">/);
    if (held[a.slug]) {
      expect(link?.[1], a.slug).toBe(held[a.slug]);
      expect(page.lastIndexOf('<section class="blk'), a.slug).toBeLessThan(page.indexOf('<a class="disc"'));
      expect(mdText.trimEnd().endsWith(`[Join the discussion on LinkedIn](${held[a.slug]})`), a.slug).toBe(true);
    } else {
      expect(link, a.slug).toBeNull();
      expect(mdText, a.slug).not.toContain('Join the discussion');
    }
  }
});

test('an article that is not due yet has no page and is not listed', async ({ request }) => {
  const out = new Set((await due(request)).map((a) => a.slug)), later = all.filter((a) => !out.has(a.slug));
  test.skip(!later.length, 'every article is due');
  const home = (await get(request, '/')).text;
  for (const a of later) {
    expect((await get(request, `/${a.slug}/`)).status, a.slug).toBe(404);
    expect((await get(request, `/${a.slug}.md`)).status, a.slug).toBe(404);
    expect(home, a.slug).not.toContain(`/${a.slug}/`);
  }
});

test('the neighbours at an article\'s end are due articles it is connected to', async ({ request }) => {
  const list = await due(request), out = new Set(list.map((a) => a.slug));
  let seen = 0;
  for (const a of list) {
    const { text } = await get(request, `/${a.slug}/`);
    for (const m of text.matchAll(/<a class="nb" href="\/([a-z0-9-]+)\/" data-i="[12]"><i>(Builds on|Came after)<\/i>/g)) {
      seen++;
      expect(out.has(m[1]), `${a.slug}: ${m[2]} ${m[1]}`).toBe(true);
      if (m[2] === 'Builds on') expect(a.links, `${a.slug} builds on ${m[1]}`).toContain(m[1]);
      else expect(all.find((b) => b.slug === m[1])!.links, `${m[1]} came after ${a.slug}`).toContain(a.slug);
    }
  }
  expect(seen, 'at least one connection').toBeGreaterThan(0);
});

test('the Off the clock cards link out to Apple Music, Polarsteps and Strava', async ({ request }) => {
  const { text } = await get(request, '/');
  const cards = [...text.matchAll(/<a class="ewin" href="([^"]+)"><span class="vh">([^<]+)<\/span><span class="card"><img src="([^"]+)"/g)];
  expect(cards).toHaveLength(3);
  expect(cards[0][1]).toMatch(/^https:\/\/music\.apple\.com\//);
  expect(cards[1][1]).toMatch(/^https:\/\/www\.polarsteps\.com\//);
  expect(cards[2][1]).toMatch(/^https:\/\/www\.strava\.com\//);
  for (const c of cards) {
    const img = await get(request, c[3]);
    expect(img.status, c[3]).toBe(200);
    expect(img.type, c[3]).toContain('image/svg+xml');
  }
});

test('the newsletter form is on the home page and on the articles', async ({ request }) => {
  const form = /<form id="nl">[\s\S]*?<input id="nl-email" type="email"[^>]*>[\s\S]*?<button type="submit">Subscribe<\/button>/;
  expect((await get(request, '/')).text).toMatch(form);
  for (const a of (await due(request)).slice(0, 10)) expect((await get(request, `/${a.slug}/`)).text, a.slug).toMatch(form);
});

test('the favicons and the manifest are served and linked', async ({ request }) => {
  const files: [string, string][] = [['/favicon.ico', 'image/'], ['/favicon.svg', 'image/svg+xml'], ['/apple-touch-icon.png', 'image/png'],
    ['/icon-192.png', 'image/png'], ['/icon-512.png', 'image/png'], ['/manifest.webmanifest', 'application/manifest+json']];
  for (const [p, type] of files) {
    const r = await get(request, p);
    expect(r.status, p).toBe(200);
    expect(r.type, p).toContain(type);
  }
  for (const icon of JSON.parse((await get(request, '/manifest.webmanifest')).text).icons) expect((await get(request, icon.src)).status, icon.src).toBe(200);
  const pages = [(await get(request, '/')).text, (await get(request, `/${(await due(request))[0].slug}/`)).text];
  const tags = ['<link rel="icon" href="/favicon.ico"', '<link rel="icon" href="/favicon.svg"', '<link rel="apple-touch-icon" href="/apple-touch-icon.png">', '<link rel="manifest" href="/manifest.webmanifest">'];
  for (const html of pages) for (const tag of tags) expect(html).toContain(tag);
});

test('the newsletter pages exist, are never indexed and stay out of the sitemap', async ({ request }) => {
  const sitemap = (await get(request, '/sitemap.xml')).text;
  for (const [p, heading] of [['/subscribed/', "You're in."], ['/link-expired/', "This link didn't work."]]) {
    const { status, text } = await get(request, p);
    expect(status, p).toBe(200);
    expect(textOf(text.match(/<h1>([\s\S]*?)<\/h1>/)![1])).toBe(heading);
    expect(text).toContain('<meta name="robots" content="noindex">');
    expect(sitemap).not.toContain(p);
  }
  expect((await get(request, '/link-expired/')).text).toContain('<form id="nl">');
});
