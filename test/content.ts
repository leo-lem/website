import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { APIRequestContext } from '@playwright/test';
import { ROOT, readArticles } from '../articles.ts';
import { readReleases, linkedinPosts } from '../posts.ts';

export const all = readArticles().map((a: { slug: string; title: string; date: string; body: string }) => ({
  slug: a.slug, title: a.title, date: a.date,
  links: [...new Set([...a.body.matchAll(/\]\(\/([a-z0-9-]+)\/?(?:#[^)]*)?\)/g)].map((m) => m[1]))],
}));

export const redirects: Record<string, string> = YAML.parse(fs.readFileSync(path.join(ROOT, 'articles/.redirects.yml'), 'utf8')) || {};

export async function due(request: APIRequestContext) {
  const text = await (await request.get('/sitemap.xml')).text();
  const slugs = new Set([...text.matchAll(/<loc>[^<]*\/([a-z0-9-]+)\/<\/loc>/g)].map((m) => m[1]));
  return all.filter((a) => slugs.has(a.slug)).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

export const posts = async (): Promise<Record<string, string>> => linkedinPosts(await readReleases(ROOT));
