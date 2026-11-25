import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml' };
const port = Number(process.env.PORT) || 4321;

const read = (f: string) => (fs.existsSync(path.join(DIST, f)) ? fs.readFileSync(path.join(DIST, f), 'utf8') : '');
const rules = read('_redirects').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
  const [from, to, code] = l.trim().split(/\s+/);
  return { re: new RegExp('^' + from.replace(/:(\w+)/g, '(?<$1>[^/]+)').replace('*', '(?<splat>.*)') + '$'), to, code: +code || 302 };
});
const extra = Object.fromEntries([...read('_headers').matchAll(/^\/\*\n((?:[ \t]+.+\n?)+)/gm)].flatMap((m) => m[1].trim().split('\n').map((h) => h.trim().split(/:\s*/, 2) as [string, string])));

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  for (const r of rules) {
    const m = url.match(r.re);
    if (m) { res.writeHead(r.code, { Location: r.to.replace(/:(\w+)/g, (_, k: string) => m.groups![k]) }).end(); return; }
  }
  if (url === '/_scenes/') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }).end(contactSheet()); return; }
  let file = path.join(DIST, url);
  if (['/_redirects', '/_headers'].includes(url)) file = path.join(DIST, 'missing');
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.endsWith('/')) { res.writeHead(301, { Location: url + '/' }).end(); return; }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) {
    const nf = path.join(DIST, '404.html');
    if (fs.existsSync(nf)) { res.writeHead(404, { 'Content-Type': TYPES['.html'] }); fs.createReadStream(nf).pipe(res); }
    else res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}/`));

function contactSheet() {
  const rows = fs.readdirSync(DIST).filter((d) => fs.existsSync(path.join(DIST, d, 'scene.svg'))).map((slug) => {
    const title = (fs.readFileSync(path.join(DIST, slug, 'index.html'), 'utf8').match(/<h1>([^<]*)<\/h1>/) || [])[1] || slug;
    return { slug, title, date: (fs.readFileSync(path.join(DIST, slug, 'index.html'), 'utf8').match(/article:published_time" content="([^"]+)/) || [])[1] || '' };
  }).sort((a, b) => b.date.localeCompare(a.date));
  return `<!doctype html><meta charset="utf-8"><title>Scenes</title><style>body{margin:0;padding:32px;background:#15171a;color:#e8e9ec;font:15px Inter,system-ui,sans-serif}h1{font-weight:500;margin:0 0 24px}.s{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:28px}.s a{color:inherit;text-decoration:none}.s figure{margin:0}.s .i{display:flex;align-items:end;gap:14px}.s .big{width:280px;border-radius:6px}.s .small{width:72px}.s figcaption{margin-top:8px;line-height:1.35}.s span{color:#8f95a3;font-size:13px}</style><h1>Scenes (${rows.length})</h1><div class="s">${rows.map((r) => `<a href="/${r.slug}/"><figure><div class="i"><img class="big" src="/${r.slug}/scene.jpg" alt=""><img class="small" src="/${r.slug}/scene.svg" alt=""></div><figcaption>${r.title}<br><span>${r.date}</span></figcaption></figure></a>`).join('')}</div>`;
}
