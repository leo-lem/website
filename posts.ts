import fs from 'node:fs';
import path from 'node:path';

export type Release = { created_at?: string; body?: string | null };
export type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<Pick<Response, 'ok' | 'status' | 'text' | 'json'> & { headers: Pick<Headers, 'get'> }>;
type Recorded = { articles?: { slug: string; channels?: { linkedin?: unknown } }[] };

const RECORD = /<!-- record\n([\s\S]*?)\n-->/;

export function linkedinPosts(releases: Release[]) {
  const posts: Record<string, string> = {};
  const oldestFirst = [...releases].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  for (const r of oldestFirst) {
    const m = (r.body || '').match(RECORD);
    if (!m) continue;
    for (const a of (JSON.parse(m[1]) as Recorded).articles || []) {
      const url = a.channels?.linkedin;
      if (typeof url === 'string' && /^https:\/\/(www\.)?linkedin\.com\//.test(url)) posts[a.slug] = url;
    }
  }
  return posts;
}

export async function readReleases(root: string, { token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY, fetch = globalThis.fetch }: { token?: string; repo?: string; fetch?: Fetch } = {}): Promise<Release[]> {
  if (token && repo) {
    const out: Release[] = [];
    for (let url: string | undefined = `${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repo}/releases?per_page=100`; url;) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
      if (!res.ok) throw new Error(`releases: ${res.status} ${await res.text()}`);
      out.push(...await res.json() as Release[]);
      url = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
    return out;
  }
  const file = path.join(root, 'releases.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}
