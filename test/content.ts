// What the tests know about the content: whatever the build read, the articles here or the stand-ins in example/
// in the public mirror. No test names an article, so they pass on either.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { APIRequestContext } from '@playwright/test';
import { ROOT, readArticles } from '../articles.mjs';

// Every article, due or not, with the article slugs its body links to.
export const all = readArticles().map((a: { slug: string; title: string; date: string; body: string }) => ({
  slug: a.slug, title: a.title, date: a.date,
  links: [...new Set([...a.body.matchAll(/\]\(\/([a-z0-9-]+)\/?(?:#[^)]*)?\)/g)].map((m) => m[1]))],
}));

// Old paths and where they go, as the build writes them into _redirects.
export const redirects: Record<string, string> = YAML.parse(fs.readFileSync(path.join(ROOT, 'articles/.redirects.yml'), 'utf8')) || {};

// The due articles are the ones the sitemap lists, whatever date the build took as today. Newest first.
export async function due(request: APIRequestContext) {
  const text = await (await request.get('/sitemap.xml')).text();
  const slugs = new Set([...text.matchAll(/<loc>[^<]*\/([a-z0-9-]+)\/<\/loc>/g)].map((m) => m[1]));
  return all.filter((a) => slugs.has(a.slug)).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}
