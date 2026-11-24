// Builds leolem.dev into dist/: node build.mjs
// Reads ../articles/*.md, checks each against docs/article-format.md, and writes the home page and
// one page per due article. Without ../articles, as in the public mirror, it reads the stand-ins in example/.
// TODAY=YYYY-MM-DD overrides today's date in Berlin.
// PREVIEW=1 builds a pull request's preview: every article, due or not, and noindex on every response.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import YAML from 'yaml';
import { Figure, ROOT, readArticles, today as todayInBerlin } from './articles.mjs';
import { execFileSync } from 'node:child_process';
import { fetchEmbeds } from './embeds.mjs';
import { buildCards } from './cards.mjs';
import { sceneSvg, sceneJpg } from './scenes.mjs';
import { plainBody } from './markdown.mjs';

const SITE = path.dirname(fileURLToPath(import.meta.url));
// Local secrets, such as Strava's, from site/.env when it exists. CI passes them as environment variables.
if (fs.existsSync(path.join(SITE, '.env'))) process.loadEnvFile(path.join(SITE, '.env'));
// The build writes into dist.next and swaps it in at the end, so a served dist/ is never half built.
const OUT = path.join(SITE, 'dist'), DIST = path.join(SITE, 'dist.next');
const src = (f) => fs.readFileSync(path.join(SITE, 'src', f), 'utf8');

// ---- reading the articles: the format is in articles.mjs ----
const today = todayInBerlin();
let all;
try { all = readArticles(); } catch (e) { console.error(e.message); process.exit(1); }
const errors = [];

const PREVIEW = !!process.env.PREVIEW;
// A preview shows articles not yet due too, so a draft for next Tuesday can be read before it goes out.
const due = all.filter((a) => PREVIEW || a.date <= today).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
const bySlug = new Map(due.map((a) => [a.slug, a]));

// ---- connections: a link from one article to another ----
const LINK = /\]\(\/([a-z0-9-]+)\/?(?:#[^)]*)?\)/g;
for (const a of due) a.links = [...new Set([...a.body.matchAll(LINK)].map((m) => m[1]))].filter((s) => s !== a.slug && bySlug.has(s));
for (const a of due) {
  // Builds on: the newest article it links to. Came after: the first article that links to it.
  a.buildsOn = a.links.map((s) => bySlug.get(s)).sort((x, y) => y.date.localeCompare(x.date))[0] || null;
  a.cameAfter = due.filter((b) => b.links.includes(a.slug)).sort((x, y) => x.date.localeCompare(y.date))[0] || null;
}

// ---- the body ----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
// A link to another article carries that article's hexagon. One to an article that is not out yet is plain text.
const HEX = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1l7.8 4.5v9L10 19l-7.8-4.5v-9z" fill="#5A6FA5"></path><path d="M10 6l3.5 2v4L10 14l-3.5-2V8z" fill="#A05070"></path></svg>';
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  const href = tokens[i].attrGet('href') || '', m = href.match(/^\/([a-z0-9-]+)\/?(#.*)?$/);
  const kind = !m ? 'a' : bySlug.has(m[1]) ? 'article' : all.some((a) => a.slug === m[1]) ? 'later' : 'a';
  (env.links ||= []).push(kind);
  if (kind === 'later') return '<span>';
  if (kind === 'article') { tokens[i].attrJoin('class', 'alink'); return self.renderToken(tokens, i, opts) + HEX; }
  return self.renderToken(tokens, i, opts);
};
md.renderer.rules.link_close = (tokens, i, opts, env, self) => (env.links.pop() === 'later' ? '</span>' : self.renderToken(tokens, i, opts));

function renderBody(a) {
  const notes = {};
  const body = a.body.replace(/^\[\^([^\]]+)\]:[ \t]*(.+)$/gm, (_, id, text) => { notes[id] = text; return ''; });
  const tokens = md.parse(body, {}), env = {}, sections = [], figures = {};
  let cur = [];
  const flush = () => { if (cur.length) sections.push({ kind: 'col', html: cur.join('\n') }); cur = []; };
  const render = (from, to) => md.renderer.render(tokens.slice(from, to), md.options, env);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let j = i; // the block's closing token
    if (t.nesting === 1) { let d = 0; for (j = i; j < tokens.length; j++) { d += tokens[j].nesting; if (d === 0) break; } }
    if (t.type === 'heading_open' && t.tag === 'h2') { flush(); cur.push(render(i, j + 1)); }
    else if (t.type === 'blockquote_open' && j - i === 4 && tokens[i + 2].content.indexOf('\n') < 0) {
      // A blockquote of one line is the key sentence.
      flush(); sections.push({ kind: 'key', html: `<p>${md.renderInline(tokens[i + 2].content, env)}</p>` });
    } else if (t.type === 'paragraph_open' && /\[\^[^\]]+\]/.test(tokens[i + 1].content)) {
      // A paragraph with a footnote gets its own section, with the note beside it.
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
      const r = Figure.safeParse(YAML.parse(t.content));
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
  const html = sections.map((s, k) => {
    const cls = ['blk', s.kind === 'key' ? 'key' : '', k === 0 ? 'first' : '', k === sections.length - 1 ? 'last' : ''].filter(Boolean).join(' ');
    if (s.kind === 'key') return `    <section class="${cls}">${s.html}</section>`;
    return `    <section class="${cls}"><div class="col">\n${s.html}\n    </div>${s.note ? `<aside class="note">${s.note}</aside>` : ''}</section>`;
  }).join('\n');
  return { html, figures };
}
function tableColumns(tokens, i) { let n = 0; for (let k = i; tokens[k].type !== 'tr_close'; k++) if (tokens[k].type === 'th_open') n++; return n; }
function sideBySide(tokens, i, j, env) {
  const rows = [];
  for (let k = i; k < j; k++) if (tokens[k].type === 'inline') rows.push(tokens[k].content);
  const cols = [[rows[0]], [rows[1]]];
  for (let k = 2; k < rows.length; k++) cols[k % 2].push(rows[k]);
  return '<div class="sbs">' + cols.map(([head, ...cells]) =>
    `<div><b>${md.renderInline(head, env)}</b><ul>${cells.filter((c) => c.trim()).map((c) => `<li>${md.renderInline(c, env)}</li>`).join('')}</ul></div>`).join('') + '</div>';
}

// ---- pages ----
const fill = (tpl, vals) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in vals)) throw new Error('no value for ' + k); return vals[k]; });
const one = (text, a, b) => { if (text.split(a).length !== 2) throw new Error('expected once: ' + a.slice(0, 60)); return text.replace(a, () => b); };
const longDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const write = (rel, text) => { const p = path.join(DIST, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(SITE, 'static'), DIST, { recursive: true });

const positioning = YAML.parse(fs.readFileSync(path.join(ROOT, 'docs/positioning.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/)[1]);

// ---- being found ----
// SITE_URL overrides the address, for previews.
const SITE_URL = (process.env.SITE_URL || 'https://leolem.dev').replace(/\/$/, '');
const abs = (p) => SITE_URL + p;
const NAME = 'Leopold Lemmermann';
const person = {
  '@type': 'Person', name: NAME, url: abs('/'), image: abs('/assets/photo.jpg'),
  jobTitle: 'Software Engineer', description: positioning.bio.short.trim().replace(/\s+/g, ' '),
  email: 'mailto:hey@leolem.dev', address: { '@type': 'PostalAddress', addressLocality: 'Hamburg', addressCountry: 'DE' },
  sameAs: Object.entries(positioning.profiles).filter(([k, v]) => v && !['site', 'newsletter'].includes(k)).map(([, v]) => v),
};
// When an article last changed: its file's last commit, never before its date. Needs the full git history.
// Commits that only moved articles over to the new format don't count as a change.
const NOT_CHANGES = ['18b3146']; // #41: every article moved into articles/ in the new format
const modified = {};
try {
  const log = execFileSync('git', ['log', '--format=@%cs %H', '--name-only', '--', 'articles/'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let day = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@')) { const [d, sha] = line.slice(1).split(' '); day = NOT_CHANGES.some((x) => sha.startsWith(x)) ? null : d; }
    else if (!day) continue;
    else { const m = line.match(/^articles\/([^/]+)\.md$/); if (m && !modified[m[1]]) modified[m[1]] = day; }
  }
} catch { /* no git: the article's date stands in */ }
const lastChange = (a) => (modified[a.slug] && modified[a.slug] > a.date ? modified[a.slug] : a.date);
// Everything a page says about itself to search engines and link previews.
function head({ title, description, path: p, type, image = '/social.jpg', ld, markdown, noindex }) {
  const url = abs(p), img = abs(image), t = esc(title), d = esc(description);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    // A page that stands in for a missing one (404) is never indexed and has no canonical address.
    noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`,
    markdown ? `<link rel="alternate" type="text/markdown" href="${abs(markdown)}">` : '',
    // A page reached with a query string is a duplicate of the canonical one: keep it out of the index.
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
// Profiles, in the order docs/positioning.md lists them; each known service has its mark in src/icons/.
const PROFILE_LABELS = { linkedin: 'LinkedIn', github: 'GitHub', devto: 'dev.to', medium: 'Medium' };
const profiles = Object.entries(positioning.profiles).filter(([k, v]) => v && PROFILE_LABELS[k])
  .map(([k, url]) => ({ label: PROFILE_LABELS[k], url, mark: src(`icons/${k}.svg`).match(/ d="([^"]+)"/)[1] }));
const HEX_ICON = 'M20 1.5L36 10.75L36 29.25L20 38.5L4 29.25L4 10.75Z';
const hexSvg = (p) => `<svg viewBox="0 0 40 40" aria-hidden="true"><path class="o" d="${HEX_ICON}"/><path class="g" transform="translate(12.8 12.8) scale(.6)" d="${p.mark}"/></svg>`;
const chrome = src('chrome.html');
const icons = `<span class="icons">${profiles.map((p) => `<a class="hx" href="${esc(p.url)}" rel="me" title="${p.label}" aria-label="${p.label}">${hexSvg(p)}</a>`).join('')}</span>`;
const profileRow = (cls = '') => `<div class="profiles ${cls}">${profiles.map((p) => `<a href="${esc(p.url)}" rel="me"><span class="hx">${hexSvg(p)}</span><span>${p.label}</span></a>`).join('')}</div>`;
const legal = `<p class="corner"><a href="/imprint/">Imprint</a> · <a href="/privacy/">Privacy</a></p>`;
const shader = src('fractal.glsl'), homeJs = src('home.js'), cal = src('cal.html'), fonts = src('fonts.html');
// The newsletter form, on the home page, every article and the expired link's page; its script and styles in
// src/newsletter.html send it to the Worker (subscribe.mjs, #39). The second, hidden field is a honeypot.
const newsletter = src('newsletter.html');
const form = `<form id="nl">
      <label for="nl-email" style="position:absolute;left:-9999px">Email</label>
      <input id="nl-email" type="email" name="email" placeholder="your@email.here" autocomplete="email" required>
      <button type="submit">Subscribe</button>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    </form>
    <p class="nl-msg" id="nl-msg" role="status" aria-live="polite"></p>`;

// A linked article's title ends in an arrow, kept on one line with the title's last word.
const linkTitle = (t) => { const w = t.split(' '), last = w.pop(); return `${esc(w.join(' '))} <span>${esc(last)}&nbsp;<i aria-hidden="true">→</i></span>`; };

// ---- Off the clock: the embeds, from data fetched now ----
const embeds = await fetchEmbeds(YAML.parse(fs.readFileSync(path.join(SITE, 'embeds.yml'), 'utf8')), path.join(DIST, 'assets/embeds'));
const cards = buildCards(embeds, path.join(DIST, 'assets/embeds'));

// The home page: the three newest articles.
const latest = due.slice(0, 3);
const [kick, ...rest] = positioning.oneliner.split('. ');
let home = fill(src('home.html'), {
  head: head({
    title: `${NAME} | ${positioning.oneliner.replace(/\.$/, '')}`, description: positioning.bio.short.trim().replace(/\s+/g, ' '),
    path: '/', type: 'profile', ld: person,
  }),
  kick: esc(kick), tag: esc(rest.join('. ')),
  cells: latest.map((a, i) => `<a href="/${a.slug}/" data-i="${i}" aria-label="${esc(a.title)}"></a>`).join(''),
  list: latest.map((a, i) => `<a href="/${a.slug}/" data-i="${i}"><b>${linkTitle(a.title)}</b><span>${a.date}</span></a>`).join('\n      '),
  scenes: json(latest.map((a) => a.scene)),
  cal, fonts, chrome, legal, icons, form, newsletter, profiles: profileRow(), music: cards.music, travel: cards.travel, run: cards.run,
});
home = one(home, '/*SHADER*/', shader);
home = one(home, '/*APP*/', homeJs);
write('index.html', home);

// The article page uses the home page's fractal, with the articles' hexagon moved inside the structure and each
// of its three hexagons shown or hidden separately, and the home page's drawing code. Adapted from docs/design/build.py.
let sh = shader;
sh = one(sh, 'AR = ivec2(15, 0)', 'AR = ivec2(2, 3)');
sh = one(sh, 'AC = vec2(0.0, 0.9375)', 'AC = vec2(0.1875 * H3, 0.21875)');
sh = one(sh, 'uniform float uHover;', 'uniform vec3 uCells;    // how far each of the three scenes shows\nuniform float uHover;');
sh = one(sh, 'inCell = cell >= 0 ? showA : 0.0,', 'inCell = cell >= 0 ? showA * uCells[cell] : 0.0,');
sh = one(sh, 'uniform float uHover;', 'uniform float uSolo;    // how far everything outside the hexagon of scenes has gone\nuniform float uHover;');
sh = one(sh, '      vec3 base = mix(BLUE, PINK, hue);', '      if (place != 1) a *= 1.0 - pieceShow(uSolo, h);\n      vec3 base = mix(BLUE, PINK, hue);');
const glCode = homeJs.slice(homeJs.indexOf('  function shader(type, src) {'), homeJs.indexOf('  // ---- what the pieces read: the photo and the scenes ----'));
const articleJs = one(src('article.js'), '/*GL*/', glCode);
const articleTpl = one(one(src('article.html'), '/*SHADER*/', sh), '/*APP*/', articleJs);

// Each article's scene, drawn once: an SVG for pages without WebGL, a JPG for link previews and channels.
await Promise.all(due.map(async (a) => {
  const svg = sceneSvg(a.scene);
  write(`${a.slug}/scene.svg`, svg);
  const p = path.join(DIST, a.slug, 'scene.jpg');
  fs.writeFileSync(p, await sceneJpg(a.scene));
}));
const imageOf = (a) => `/${a.slug}/scene.jpg`;

for (const a of due) {
  const { html, figures } = renderBody(a);
  const nb = (b, i, label) => !b ? '' : `    <a class="hit" href="/${b.slug}/" data-i="${i}" aria-hidden="true" tabindex="-1"></a>\n    <a class="nb" href="/${b.slug}/" data-i="${i}"><i>${label}</i><b>${linkTitle(b.title)}</b></a>`;
  write(`${a.slug}/index.html`, fill(articleTpl, {
    head: head({
      title: `${a.title} | ${NAME}`, description: a.summary, path: `/${a.slug}/`, type: 'article', markdown: `/${a.slug}.md`, image: imageOf(a),
      ld: {
        '@type': 'BlogPosting', headline: a.title, description: a.summary, url: abs(`/${a.slug}/`), mainEntityOfPage: abs(`/${a.slug}/`),
        datePublished: a.date, dateModified: lastChange(a), inLanguage: 'en', image: abs(imageOf(a)),
        author: a.author ? { '@type': 'Person', name: a.author.name, url: a.author.url } : { '@type': 'Person', name: NAME, url: abs('/') },
        publisher: { '@type': 'Person', name: NAME, url: abs('/') },
      },
    }) + `\n<meta property="article:published_time" content="${a.date}">\n<meta property="article:modified_time" content="${lastChange(a)}">`,
    title: esc(a.title), summary: esc(a.summary), date: longDate(a.date),
    scene: `\n    <img class="scene" src="/${a.slug}/scene.svg" alt="" width="600" height="600">`,
    credit: a.author ? `\n      <p class="credit">By <a href="${esc(a.author.url)}">${esc(a.author.name)}</a></p>` : '',
    body: html, cal, fonts, chrome, icons, legal, form, newsletter,
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

// ---- plain pages: imprint, privacy, 404 ----
// The article's text column on the dark page, no WebGL, with a quiet hexagon of the fractal's pieces beside it.
function decoration() {
  const H3 = 0.8660254, R = 300, cx = 300, cy = 300, rnd = (i) => { let x = Math.imul(i ^ (i >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const V = [...Array(6)].map((_, k) => { const a = Math.PI / 3 * k - Math.PI / 2; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], fills = {};
  const put = (t, l, accent) => { const c = [t.reduce((s, p) => s + p[0], 0) / 3, t.reduce((s, p) => s + p[1], 0) / 3], f = accent ? `rgb(${Math.round(160 * l)},${Math.round(80 * l)},${Math.round(112 * l)})` : `rgb(${Math.round(90 * l)},${Math.round(111 * l)},${Math.round(165 * l)})`; (fills[f] ||= []).push('M' + t.map((p) => [c[0] + (p[0] - c[0]) * 0.88, c[1] + (p[1] - c[1]) * 0.88].map((v) => v.toFixed(1)).join(' ')).join('L') + 'Z'); };
  // Six triangles, each split down a few levels at random: big and small pieces together, a few left out.
  let n = 0;
  const split = (t, depth) => {
    const r = rnd(++n * 7919);
    if (depth < 4 && r < [1, 0.7, 0.5, 0.35][depth]) { const [a, b, c] = t, ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]].forEach((s) => split(s, depth + 1)); return; }
    if (r > 0.86) return;
    put(t, Math.round((0.32 + 0.4 * rnd(n * 31)) * 6) / 6, r < 0.02);
  };
  V.forEach((v, k) => split([[cx, cy], v, V[(k + 1) % 6]], 0));
  return `<svg class="deco" viewBox="0 0 600 600" aria-hidden="true">${Object.entries(fills).map(([f, d]) => `<path fill="${f}" d="${d.join('')}"/>`).join('')}</svg>`;
}
const pageTpl = src('page.html'), deco = decoration();
function page(rel, { title, description, lang = 'en', body, noindex, withForm }) {
  const p = '/' + rel.replace(/index\.html$/, '');
  write(rel, fill(pageTpl, {
    lang, deco, cal, fonts, chrome, icons, legal,
    body: withForm ? `${body}\n  ${form}` : body, newsletter: withForm ? newsletter : '',
    head: head({ title: `${title} | ${NAME}`, description, path: p, type: 'website', noindex, ld: { '@type': 'WebPage', name: title, url: abs(p) } }),
  }));
}
// The newsletter's two pages (#39) are where its confirmation links lead: never indexed, not in the sitemap.
// form: true puts the newsletter form under the text.
for (const name of ['imprint', 'privacy', 'subscribed', 'link-expired']) {
  const m = fs.readFileSync(path.join(SITE, 'src/pages', `${name}.md`), 'utf8').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/), meta = YAML.parse(m[1]);
  const { kick, form: withForm, heading = meta.title, ...rest } = meta;
  page(`${name}/index.html`, { ...rest, withForm, body: `${kick ? `  <p class="kick">${esc(kick)}</p>\n` : ''}  <h1>${esc(heading)}</h1>\n${md.render(m[2])}` });
}
// The 404: a friendly way back, home or to the newest articles.
page('404.html', {
  title: 'Page not found', description: 'This page does not exist.', noindex: true,
  body: `  <p class="kick">404</p>\n  <h1>This page doesn't exist.</h1>\n  <p>Maybe it moved, maybe it never was. The <a href="/">home page</a> is a good place to start, or one of the newest articles:</p>\n  <div class="list">${due.slice(0, 3).map((a) => `<a href="/${a.slug}/"><b>${esc(a.title)}</b><span>${longDate(a.date)}</span></a>`).join('')}</div>`,
});

// ---- for machines: Markdown versions, llms.txt, sitemap, robots.txt ----
// An article as Markdown that reads well without the site (markdown.mjs).
function markdownOf(a) {
  const by = a.author ? `by ${a.author.name}` : `by ${NAME}`;
  return `# ${a.title}\n\n${a.summary}\n\n*${longDate(a.date)}, ${by}. ${abs(`/${a.slug}/`)}*\n\n${plainBody(a.body, SITE_URL)}\n`;
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
// Every crawler is welcome, training ones included (#43).
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);

// ---- for Cloudflare: redirects and headers ----
// Old paths from articles/.redirects.yml first, then the general rule for every article of the old site.
// Each with and without its trailing slash, so neither depends on how Cloudflare matches slashes.
const redirects = YAML.parse(fs.readFileSync(path.join(ROOT, 'articles/.redirects.yml'), 'utf8'));
const slugs = new Set(all.map((a) => a.slug));
// /x/* also gets /x, which its * doesn't reach.
const variants = (from) => [from, from.replace(/\/\*?$/, '')];
const lines = [];
for (const [from, to] of Object.entries(redirects)) {
  if (!/^\/.+\/\*?$/.test(from)) errors.push(`articles/.redirects.yml: ${from}: a path with a trailing slash, or /* for everything below it`);
  if (to !== '/' && !slugs.has(to.replace(/^\/|\/$/g, ''))) errors.push(`articles/.redirects.yml: ${from}: ${to} is no article`);
  for (const v of variants(from)) lines.push(`${v} ${to} 301`);
}
for (const v of variants('/blog/:category/:slug/')) lines.push(`${v} /:slug/ 301`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
write('_redirects', lines.join('\n') + '\n');
// Previews are public, so they tell every crawler to stay away (#43). Production gets no _headers at all.
if (PREVIEW) write('_headers', '/*\n  X-Robots-Tag: noindex\n');

fs.rmSync(OUT, { recursive: true, force: true });
fs.renameSync(DIST, OUT);
console.log(PREVIEW ? `built all ${all.length} articles into dist/ as a preview` : `built ${due.length} of ${all.length} articles (due on or before ${today}) into dist/`);
