import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import YAML from 'yaml';
import { Figure, ROOT, readArticles, today as todayInBerlin } from './articles.ts';
import type { Article, FigureData } from './articles.ts';
import type { Token } from 'markdown-it';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { fetchEmbeds } from './embeds.ts';
import type { EmbedConfig } from './embeds.ts';
import { buildCards } from './cards.ts';
import { sceneSvg, sceneJpg } from './scenes.ts';
import type { Point } from './scenes.ts';
import { plainBody, figureData, readMinutes } from './markdown.ts';
import { readReleases, linkedinPosts } from './posts.ts';

type Page = Article & { links: string[]; buildsOn: Page | null; cameAfter: Page | null };
type Env = { links?: string[] };
type Section = { kind: 'col' | 'key'; html: string; note?: string };
type Positioning = { oneliner: string; bio: { short: string; long: string }; profiles: Record<string, string | null> };
type PageMeta = { title: string; description: string; lang?: string; noindex?: boolean; kick?: string; form?: boolean; heading?: string };

const SITE = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(SITE, '.env'))) process.loadEnvFile(path.join(SITE, '.env'));
const OUT = path.join(SITE, 'dist'), DIST = path.join(SITE, 'dist.next');
const src = (f: string) => fs.readFileSync(path.join(SITE, 'src', f), 'utf8');

const today = todayInBerlin();
let all: Article[];
try { all = readArticles(); } catch (e) { console.error((e as Error).message); process.exit(1); }
const errors: string[] = [];

const PREVIEW = !!process.env.PREVIEW;
const due = all.filter((a) => PREVIEW || a.date <= today).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
  .map((a): Page => Object.assign(a, { links: [], buildsOn: null, cameAfter: null }));
const bySlug = new Map(due.map((a) => [a.slug, a]));

const LINK = /\]\(\/([a-z0-9-]+)\/?(?:#[^)]*)?\)/g;
for (const a of due) a.links = [...new Set([...a.body.matchAll(LINK)].map((m) => m[1]))].filter((s) => s !== a.slug && bySlug.has(s));
for (const a of due) {
  a.buildsOn = a.links.map((s) => bySlug.get(s)!).sort((x, y) => y.date.localeCompare(x.date))[0] || null;
  a.cameAfter = due.filter((b) => b.links.includes(a.slug)).sort((x, y) => x.date.localeCompare(y.date))[0] || null;
}

let posts: Record<string, string> = {};
try { posts = linkedinPosts(await readReleases(ROOT)); } catch (e) { console.warn(`::warning::no links to the LinkedIn discussions: ${(e as Error).message}`); }

const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
const HEX = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1l7.8 4.5v9L10 19l-7.8-4.5v-9z" fill="#5A6FA5"></path><path d="M10 6l3.5 2v4L10 14l-3.5-2V8z" fill="#A05070"></path></svg>';
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  const href = String(tokens[i].attrGet('href') || ''), m = href.match(/^\/([a-z0-9-]+)\/?(#.*)?$/);
  const kind = !m ? 'a' : bySlug.has(m[1]) ? 'article' : all.some((a) => a.slug === m[1]) ? 'later' : 'a';
  ((env!.links ||= []) as string[]).push(kind);
  if (kind === 'later') return '<span>';
  if (kind === 'article') { tokens[i].attrJoin('class', 'alink'); return self.renderToken(tokens, i, opts) + HEX; }
  return self.renderToken(tokens, i, opts);
};
md.renderer.rules.link_close = (tokens, i, opts, env, self) => ((env!.links as string[]).pop() === 'later' ? '</span>' : self.renderToken(tokens, i, opts));

function renderBody(a: Page, end = '') {
  const notes: Record<string, string> = {};
  const body = a.body.replace(/^\[\^([^\]]+)\]:[ \t]*(.+)$/gm, (_, id: string, text: string) => { notes[id] = text; return ''; });
  const tokens = md.parse(body, {}), env: Env = {}, sections: Section[] = [], figures: Record<string, FigureData['forms']> = {};
  let cur: string[] = [];
  const flush = () => { if (cur.length) sections.push({ kind: 'col', html: cur.join('\n') }); cur = []; };
  const render = (from: number, to: number) => md.renderer.render(tokens.slice(from, to), md.options, env);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let j = i;
    if (t.nesting === 1) { let d = 0; for (j = i; j < tokens.length; j++) { d += tokens[j].nesting; if (d === 0) break; } }
    if (t.type === 'heading_open' && t.tag === 'h2') { flush(); cur.push(render(i, j + 1)); }
    else if (t.type === 'blockquote_open' && j - i === 4 && tokens[i + 2].content.indexOf('\n') < 0) {
      flush(); sections.push({ kind: 'key', html: `<p>${md.renderInline(tokens[i + 2].content, env)}</p>` });
    } else if (t.type === 'paragraph_open' && /\[\^[^\]]+\]/.test(tokens[i + 1].content)) {
      flush();
      const ids = [...tokens[i + 1].content.matchAll(/\[\^([^\]]+)\]/g)].map((m) => m[1]);
      const html = render(i, j + 1).replace(/\[\^[^\]]+\]/g, '');
      sections.push({ kind: 'col', html, note: ids.map((id) => md.renderInline(notes[id] || '', env)).join(' ') });
    } else if (t.type === 'table_open' && tableColumns(tokens, i) === 2) {
      cur.push(sideBySide(tokens, i, j, env));
    } else if (t.type === 'fence' && t.info.trim() === 'number') {
      const [value, ...what] = t.content.trim().split('\n');
      cur.push(`<div class="num"><b>${esc(value)}</b><span>${esc(what.join(' '))}</span></div>`);
    } else if (t.type === 'fence' && t.info.trim() === 'figure') {
      const r = Figure.safeParse(figureData(t.content));
      if (!r.success) { console.error(`${a.slug}.md: figure: ${r.error.issues.map((x) => x.path.join('.') + ' ' + x.message).join(', ')}`); process.exit(1); }
      const id = 'fig' + (Object.keys(figures).length + 1);
      figures[id] = r.data.forms;
      cur.push(`<figure class="fig" id="${id}" role="img" aria-label="${esc(r.data.alt)}"><canvas></canvas><figcaption>${esc(r.data.alt)}</figcaption></figure>`);
    } else if (t.type === 'fence') {
      cur.push(`<pre><code${t.info.trim() ? ` class="language-${esc(t.info.trim())}"` : ''}>${esc(t.content.replace(/\n$/, ''))}</code></pre>`);
    } else cur.push(render(i, j + 1));
    i = j;
  }
  flush();
  if (end) { const last = sections.at(-1); if (last?.kind === 'col') last.html += '\n' + end; else sections.push({ kind: 'col', html: end }); }
  const html = sections.map((s, k) => {
    const cls = ['blk', s.kind === 'key' ? 'key' : '', k === 0 ? 'first' : '', k === sections.length - 1 ? 'last' : ''].filter(Boolean).join(' ');
    if (s.kind === 'key') return `    <section class="${cls}">${s.html}</section>`;
    return `    <section class="${cls}"><div class="col">\n${s.html}\n    </div>${s.note ? `<aside class="note">${s.note}</aside>` : ''}</section>`;
  }).join('\n');
  return { html, figures };
}
function tableColumns(tokens: Token[], i: number) { let n = 0; for (let k = i; tokens[k].type !== 'tr_close'; k++) if (tokens[k].type === 'th_open') n++; return n; }
function sideBySide(tokens: Token[], i: number, j: number, env: Env) {
  const rows: string[] = [];
  for (let k = i; k < j; k++) if (tokens[k].type === 'inline') rows.push(tokens[k].content);
  const cols = [[rows[0]], [rows[1]]];
  for (let k = 2; k < rows.length; k++) cols[k % 2].push(rows[k]);
  return '<div class="sbs">' + cols.map(([head, ...cells]) =>
    `<div><b>${md.renderInline(head, env)}</b><ul>${cells.filter((c) => c.trim()).map((c) => `<li>${md.renderInline(c, env)}</li>`).join('')}</ul></div>`).join('') + '</div>';
}

const fill = (tpl: string, vals: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => { if (!(k in vals)) throw new Error('no value for ' + k); return vals[k]; });
const one = (text: string, a: string, b: string) => { if (text.split(a).length !== 2) throw new Error('expected once: ' + a.slice(0, 60)); return text.replace(a, () => b); };
const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const write = (rel: string, text: string) => { const p = path.join(DIST, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(SITE, 'static'), DIST, { recursive: true });

const positioning = YAML.parse(fs.readFileSync(path.join(ROOT, 'docs/positioning.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/)![1]) as Positioning;

const SITE_URL = (process.env.SITE_URL || 'https://leolem.dev').replace(/\/$/, '');
const abs = (p: string) => SITE_URL + p;
const NAME = 'Leopold Lemmermann';
const person = {
  '@type': 'Person', name: NAME, url: abs('/'), image: abs('/assets/photo.jpg'),
  jobTitle: 'Software Engineer', description: positioning.bio.short.trim().replace(/\s+/g, ' '),
  email: 'mailto:hey@leolem.dev', address: { '@type': 'PostalAddress', addressLocality: 'Hamburg', addressCountry: 'DE' },
  sameAs: Object.entries(positioning.profiles).filter(([k, v]) => v && k !== 'site').map(([, v]) => v),
};
const NOT_CHANGES = ['18b3146'];
const modified: Record<string, string> = {};
try {
  const log = execFileSync('git', ['log', '--format=@%cs %H', '--name-only', '--', 'articles/'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let day: string | null = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@')) { const [d, sha] = line.slice(1).split(' '); day = NOT_CHANGES.some((x) => sha.startsWith(x)) ? null : d; }
    else if (!day) continue;
    else { const m = line.match(/^articles\/([^/]+)\.md$/); if (m && !modified[m[1]]) modified[m[1]] = day; }
  }
} catch {  }
const lastChange = (a: Article) => (modified[a.slug] && modified[a.slug] > a.date ? modified[a.slug] : a.date);
function head({ title, description, path: p, type, image = '/social.jpg', ld, markdown, noindex }: { title: string; description: string; path: string; type: string; image?: string; ld: object; markdown?: string; noindex?: boolean }) {
  const url = abs(p), img = abs(image), t = esc(title), d = esc(description);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`,
    markdown ? `<link rel="alternate" type="text/markdown" href="${abs(markdown)}">` : '',
    `<script>if (location.search) document.write('<meta name="robots" content="noindex,follow">');</script>`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:site_name" content="${NAME}">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${img}">`,
    `<script type="application/ld+json">${json({ '@context': 'https://schema.org', ...ld })}</script>`,
  ].filter(Boolean).join('\n');
}
const PROFILE_LABELS: Record<string, string> = { linkedin: 'LinkedIn', github: 'GitHub', devto: 'dev.to', medium: 'Medium' };
const profiles = Object.entries(positioning.profiles).filter(([k, v]) => v && PROFILE_LABELS[k])
  .map(([k, url]) => ({ label: PROFILE_LABELS[k], url, mark: src(`icons/${k}.svg`).match(/ d="([^"]+)"/)![1] }));
const HEX_ICON = 'M20 1.5L36 10.75L36 29.25L20 38.5L4 29.25L4 10.75Z';
const hexSvg = (p: { mark: string }) => `<svg viewBox="0 0 40 40" aria-hidden="true"><path class="o" d="${HEX_ICON}"/><path class="g" transform="translate(12.8 12.8) scale(.6)" d="${p.mark}"/></svg>`;
const chrome = src('chrome.html');
const mark = fs.readFileSync(path.join(SITE, 'static/favicon.svg'), 'utf8').trim().replace(/<rect [^>]*\/>/, '').replace('<svg ', '<svg class="mark" width="28" height="28" aria-hidden="true" ');
const icons = `<span class="icons">${profiles.map((p) => `<a class="hx" href="${esc(p.url)}" rel="me" title="${p.label}" aria-label="${p.label}">${hexSvg(p)}</a>`).join('')}</span>`;
const profileRow = (cls = '') => `<div class="profiles ${cls}">${profiles.map((p) => `<a href="${esc(p.url)}" rel="me"><span class="hx">${hexSvg(p)}</span><span>${p.label}</span></a>`).join('')}</div>`;
const legal = `<p class="corner"><a href="/imprint/">Imprint</a> · <a href="/privacy/">Privacy</a></p>`;
const shader = src('fractal.glsl'), homeJs = stripTypeScriptTypes(src('home.ts')), cal = src('cal.html'), fonts = src('fonts.html');
const newsletter = src('newsletter.html');
const form = `<form id="nl">
      <label for="nl-email" class="vh">Email</label>
      <input id="nl-email" type="email" name="email" placeholder="your@email.here" autocomplete="email" required>
      <button type="submit">Subscribe</button>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    </form>
    <p class="nl-msg" id="nl-msg" role="status" aria-live="polite"></p>`;

const linkTitle = (t: string) => { const w = t.split(' '), last = w.pop(); return `${esc(w.join(' '))} <span>${esc(last)}&nbsp;<i aria-hidden="true">→</i></span>`; };

const embeds = await fetchEmbeds(YAML.parse(fs.readFileSync(path.join(SITE, 'embeds.yml'), 'utf8')) as EmbedConfig, path.join(DIST, 'assets/embeds'));
const cards = buildCards(embeds, path.join(DIST, 'assets/embeds'));

const latest = due.slice(0, 3);
const [kick, ...rest] = positioning.oneliner.split('. ');
let home = fill(src('home.html'), {
  head: head({
    title: `${NAME} | ${positioning.oneliner.replace(/\.$/, '')}`, description: positioning.bio.short.trim().replace(/\s+/g, ' '),
    path: '/', type: 'profile', ld: person,
  }),
  kick: esc(kick), tag: esc(rest.join('. ')),
  cells: latest.map((a, i) => `<a href="/${a.slug}/" data-i="${i}" aria-hidden="true" tabindex="-1"><span class="vh">${esc(a.title)}</span></a>`).join(''),
  list: latest.map((a, i) => `<a href="/${a.slug}/" data-i="${i}"><b>${linkTitle(a.title)}</b><span>${a.date}</span></a>`).join('\n      '),
  scenes: json(latest.map((a) => a.scene)),
  cal, fonts, chrome, legal, icons, mark, form, newsletter, profiles: profileRow(), music: cards.music, travel: cards.travel, run: cards.run,
});
home = one(home, '/*SHADER*/', shader);
home = one(home, '/*APP*/', homeJs);
write('index.html', home);

let sh = shader;
sh = one(sh, 'AR = ivec2(15, 0)', 'AR = ivec2(2, 3)');
sh = one(sh, 'AC = vec2(0.0, 0.9375)', 'AC = vec2(0.1875 * H3, 0.21875)');
sh = one(sh, 'uniform float uHover;', 'uniform vec3 uCells;\nuniform float uHover;');
sh = one(sh, 'inCell = cell >= 0 ? showA : 0.0,', 'inCell = cell >= 0 ? showA * uCells[cell] : 0.0,');
sh = one(sh, 'uniform float uHover;', 'uniform float uSolo;\nuniform float uHover;');
sh = one(sh, '      vec3 base = mix(BLUE, PINK, hue);', '      if (place != 1) a *= 1.0 - pieceShow(uSolo, h);\n      vec3 base = mix(BLUE, PINK, hue);');
const glCode = homeJs.slice(homeJs.indexOf('  function shader('), homeJs.indexOf('  function upload('));
const articleJs = one(stripTypeScriptTypes(src('article.ts')), '/*GL*/', glCode);
const articleTpl = one(one(src('article.html'), '/*SHADER*/', sh), '/*APP*/', articleJs);

await Promise.all(due.map(async (a) => {
  const svg = sceneSvg(a.scene);
  write(`${a.slug}/scene.svg`, svg);
  const p = path.join(DIST, a.slug, 'scene.jpg');
  fs.writeFileSync(p, await sceneJpg(a.scene));
}));
const imageOf = (a: Article) => `/${a.slug}/scene.jpg`;

const LINKEDIN = src('icons/linkedin.svg').match(/ d="([^"]+)"/)![1];
const discussion = (url: string) => `      <a class="disc" href="${esc(url)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${LINKEDIN}"/></svg><span>Join the discussion on LinkedIn</span><i aria-hidden="true">→</i></a>`;

for (const a of due) {
  const { html, figures } = renderBody(a, posts[a.slug] ? discussion(posts[a.slug]) : '');
  const minutes = readMinutes(a.body);
  const nb = (b: Page | null, i: number, label: string) => !b ? '' : `    <a class="hit" href="/${b.slug}/" data-i="${i}" aria-hidden="true" tabindex="-1"></a>\n    <a class="nb" href="/${b.slug}/" data-i="${i}"><i>${label}</i><b>${linkTitle(b.title)}</b></a>`;
  write(`${a.slug}/index.html`, fill(articleTpl, {
    head: head({
      title: `${a.title} | ${NAME}`, description: a.summary, path: `/${a.slug}/`, type: 'article', markdown: `/${a.slug}.md`, image: imageOf(a),
      ld: {
        '@type': 'BlogPosting', headline: a.title, description: a.summary, url: abs(`/${a.slug}/`), mainEntityOfPage: abs(`/${a.slug}/`),
        datePublished: a.date, dateModified: lastChange(a), inLanguage: 'en', image: abs(imageOf(a)),
        timeRequired: `PT${minutes}M`,
        author: a.author ? { '@type': 'Person', name: a.author.name, url: a.author.url } : { '@type': 'Person', name: NAME, url: abs('/') },
        publisher: { '@type': 'Person', name: NAME, url: abs('/') },
      },
    }) + `\n<meta property="article:published_time" content="${a.date}">\n<meta property="article:modified_time" content="${lastChange(a)}">`,
    title: esc(a.title), summary: esc(a.summary), date: longDate(a.date), read: `${minutes} min read`,
    scene: `\n    <img class="scene" src="/${a.slug}/scene.svg" alt="" width="600" height="600">`,
    credit: a.author ? `\n      <p class="credit">By <a href="${esc(a.author.url)}">${esc(a.author.name)}</a></p>` : '',
    body: html, cal, fonts, chrome, icons, mark, legal, form, newsletter,
    neighbours: [
      `    <a class="hit" href="#" data-i="0" aria-hidden="true" tabindex="-1"></a>\n    <a class="nb up" href="#" data-i="0" aria-label="Back to the start of ${esc(a.title)}"><i aria-hidden="true">↑</i><b>${esc(a.title)}</b></a>`,
      nb(a.buildsOn, 2, 'Builds on'), nb(a.cameAfter, 1, 'Came after'),
    ].filter(Boolean).join('\n'),
    page: json({
      scenes: [a.scene, a.cameAfter?.scene || null, a.buildsOn?.scene || null],
      has: [true, !!a.cameAfter, !!a.buildsOn],
      figures,
    }),
  }));
}

function decoration() {
  const H3 = 0.8660254, R = 300, cx = 300, cy = 300, rnd = (i: number) => { let x = Math.imul(i ^ (i >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const V = [...Array(6)].map((_, k): Point => { const a = Math.PI / 3 * k - Math.PI / 2; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
  const mid = (p: Point, q: Point): Point => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], fills: Record<string, string[]> = {};
  const put = (t: Point[], l: number, accent: boolean) => { const c = [t.reduce((s, p) => s + p[0], 0) / 3, t.reduce((s, p) => s + p[1], 0) / 3], f = accent ? `rgb(${Math.round(160 * l)},${Math.round(80 * l)},${Math.round(112 * l)})` : `rgb(${Math.round(90 * l)},${Math.round(111 * l)},${Math.round(165 * l)})`; (fills[f] ||= []).push('M' + t.map((p) => [c[0] + (p[0] - c[0]) * 0.88, c[1] + (p[1] - c[1]) * 0.88].map((v) => v.toFixed(1)).join(' ')).join('L') + 'Z'); };
  let n = 0;
  const split = (t: Point[], depth: number): void => {
    const r = rnd(++n * 7919);
    if (depth < 4 && r < [1, 0.7, 0.5, 0.35][depth]) { const [a, b, c] = t, ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]].forEach((s) => split(s, depth + 1)); return; }
    if (r > 0.86) return;
    put(t, Math.round((0.32 + 0.4 * rnd(n * 31)) * 6) / 6, r < 0.02);
  };
  V.forEach((v, k) => split([[cx, cy], v, V[(k + 1) % 6]], 0));
  return `<svg class="deco" viewBox="0 0 600 600" aria-hidden="true">${Object.entries(fills).map(([f, d]) => `<path fill="${f}" d="${d.join('')}"/>`).join('')}</svg>`;
}
const pageTpl = src('page.html'), deco = decoration();
function page(rel: string, { title, description, lang = 'en', body, noindex, withForm }: { title: string; description: string; lang?: string; body: string; noindex?: boolean; withForm?: boolean }) {
  const p = '/' + rel.replace(/index\.html$/, '');
  write(rel, fill(pageTpl, {
    lang, deco, cal, fonts, chrome, icons, mark, legal,
    body: withForm ? `${body}\n  ${form}` : body, newsletter: withForm ? newsletter : '',
    head: head({ title: `${title} | ${NAME}`, description, path: p, type: 'website', noindex, ld: { '@type': 'WebPage', name: title, url: abs(p) } }),
  }));
}
for (const name of ['imprint', 'privacy', 'subscribed', 'link-expired']) {
  const m = fs.readFileSync(path.join(SITE, 'src/pages', `${name}.md`), 'utf8').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)!, meta = YAML.parse(m[1]) as PageMeta;
  const { kick, form: withForm, heading = meta.title, ...rest } = meta;
  page(`${name}/index.html`, { ...rest, withForm, body: `${kick ? `  <p class="kick">${esc(kick)}</p>\n` : ''}  <h1>${esc(heading)}</h1>\n${md.render(m[2])}` });
}
page('404.html', {
  title: 'Page not found', description: 'This page does not exist.', noindex: true,
  body: `  <p class="kick">404</p>\n  <h1>This page doesn't exist.</h1>\n  <p>Maybe it moved, maybe it never was. The <a href="/">home page</a> is a good place to start, or one of the newest articles:</p>\n  <div class="list">${due.slice(0, 3).map((a) => `<a href="/${a.slug}/"><b>${esc(a.title)}</b><span>${longDate(a.date)}</span></a>`).join('')}</div>`,
});

function markdownOf(a: Page) {
  const by = a.author ? `by ${a.author.name}` : `by ${NAME}`;
  const disc = posts[a.slug] ? `\n[Join the discussion on LinkedIn](${posts[a.slug]})\n` : '';
  return `# ${a.title}\n\n${a.summary}\n\n*${longDate(a.date)}, ${by}. ${abs(`/${a.slug}/`)}*\n\n${plainBody(a.body, SITE_URL)}\n${disc}`;
}
for (const a of due) write(`${a.slug}.md`, markdownOf(a));

write('llms.txt', [
  `# ${NAME}`, '',
  `> ${positioning.oneliner}`, '',
  positioning.bio.long.trim(), '',
  `Every article is also available as Markdown at ${SITE_URL}/<slug>.md.`, '',
  '## Articles', '',
  ...due.map((a) => `- [${a.title}](${abs(`/${a.slug}.md`)}): ${a.summary}`), '',
  '## Profiles', '',
  ...Object.entries(positioning.profiles).filter(([k, v]) => v && k !== 'site').map(([k, v]) => `- [${k}](${v})`), '',
].join('\n'));

write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${abs('/')}</loc>${due[0] ? `<lastmod>${due[0].date}</lastmod>` : ''}</url>
${due.map((a) => `  <url><loc>${abs(`/${a.slug}/`)}</loc><lastmod>${lastChange(a)}</lastmod></url>`).join('\n')}
</urlset>
`);
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);

const redirects = YAML.parse(fs.readFileSync(path.join(ROOT, 'articles/.redirects.yml'), 'utf8')) as Record<string, string>;
const slugs = new Set(all.map((a) => a.slug));
const variants = (from: string) => [from, from.replace(/\/\*?$/, '')];
const lines: string[] = [];
for (const [from, to] of Object.entries(redirects)) {
  if (!/^\/.+\/\*?$/.test(from)) errors.push(`articles/.redirects.yml: ${from}: a path with a trailing slash, or /* for everything below it`);
  const slug = to.replace(/^\/|\/$/g, '');
  if (to !== '/' && !slugs.has(slug)) errors.push(`articles/.redirects.yml: ${from}: ${to} is no article`);
  const live = to === '/' || bySlug.has(slug) ? to : '/';
  for (const v of variants(from)) lines.push(`${v} ${live} 301`);
}
for (const v of variants('/blog/:category/:slug/')) lines.push(`${v} /:slug/ 301`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
write('_redirects', lines.join('\n') + '\n');
if (PREVIEW) write('_headers', '/*\n  X-Robots-Tag: noindex\n');

fs.rmSync(OUT, { recursive: true, force: true });
fs.renameSync(DIST, OUT);
console.log(PREVIEW ? `built all ${all.length} articles into dist/ as a preview` : `built ${due.length} of ${all.length} articles (due on or before ${today}) into dist/`);
