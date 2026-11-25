import fs from 'node:fs';
import path from 'node:path';
import type { Embeds, LatLon, Leg } from './embeds.ts';

type Point = [number, number];
type Edge = [Point, Point];
type Land = { pts: Point[]; box: number[] };
export type Cards = { music: string; travel: string; run: string };

const H3 = 0.8660254, BOX = 600, cx = 300, cy = 300, R = 300, S0 = 60, h0 = S0 * H3;
const P = [90, 111, 165], LP = [128, 150, 232], LA = [226, 120, 160];
const h32 = (x: number) => { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c: number[], l: number) => `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(255, v * l)) / 6) * 6).join(',')})`;
const V = [...Array(6)].map((_, k): Point => { const a = Math.PI / 3 * k - Math.PI / 2; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
const C: Point = [cx, cy], FACE = { music: [V[5], V[0], V[1], C], travel: [V[5], C, V[3], V[4]], run: [C, V[1], V[2], V[3]] };
const OUTER = V.map((v, i): Edge => [v, V[(i + 1) % 6]]), INNER: Edge[] = [[C, V[1]], [C, V[3]], [C, V[5]]];
const inPoly = (p: Point[], x: number, y: number) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
const segD = (x: number, y: number, a: Point, b: Point) => { const bx = b[0] - a[0], by = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * bx + (y - a[1]) * by) / (bx * bx + by * by || 1))); return Math.hypot(x - a[0] - bx * t, y - a[1] - by * t); };
const lineD = (pts: Point[], x: number, y: number) => { let d = 1e9; for (let i = 1; i < pts.length; i++) d = Math.min(d, segD(x, y, pts[i - 1], pts[i])); return d; };
const along = (pts: Point[], x: number, y: number) => { let best = 1e9, at = 0, run = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], bx = b[0] - a[0], by = b[1] - a[1], len = Math.hypot(bx, by), t = Math.max(0, Math.min(1, ((x - a[0]) * bx + (y - a[1]) * by) / (len * len || 1))), d = Math.hypot(x - a[0] - bx * t, y - a[1] - by * t); if (d < best) { best = d; at = run + t * len; } run += len; } return at; };
const arc = (a: Point, b: Point) => { const dx = b[0] - a[0], dy = b[1] - a[1], m = [(a[0] + b[0]) / 2 + dy * 0.85, (a[1] + b[1]) / 2 - dx * 0.85]; return [...Array(25)].map((_, i): Point => { const t = i / 24, u = 1 - t; return [u * u * a[0] + 2 * u * t * m[0] + t * t * b[0], u * u * a[1] + 2 * u * t * m[1] + t * t * b[1]]; }); };
const edgeD = (edges: Edge[], x: number, y: number) => Math.min(...edges.map(([a, b]) => segD(x, y, a, b)));
function fitIn(points: Point[], region: Point[], margin: number, zoom = 1) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]), x0 = (Math.min(...xs) + Math.max(...xs)) / 2, y0 = (Math.min(...ys) + Math.max(...ys)) / 2;
  const step = Math.max(1, Math.floor(points.length / 90)), probe = points.filter((_, i) => i % step === 0).map((p): Point => [p[0] - x0, p[1] - y0]);
  const edges = region.map((p, i): Edge => [p, region[(i + 1) % region.length]]), rx = region.map((p) => p[0]), ry = region.map((p) => p[1]);
  const fits = (cx0: number, cy0: number, sc: number) => probe.every((p) => { const x = cx0 + p[0] * sc, y = cy0 + p[1] * sc; return inPoly(region, x, y) && edgeD(edges, x, y) >= margin; });
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9), most = (Math.max(...rx) - Math.min(...rx) + Math.max(...ry) - Math.min(...ry)) / span;
  let best = { sc: 0, x: (Math.min(...rx) + Math.max(...rx)) / 2, y: (Math.min(...ry) + Math.max(...ry)) / 2 };
  for (let gx = Math.min(...rx); gx <= Math.max(...rx); gx += 6) for (let gy = Math.min(...ry); gy <= Math.max(...ry); gy += 6) {
    if (!fits(gx, gy, best.sc * 1.02 || 1e-9)) continue;
    let lo = best.sc, hi = most;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (fits(gx, gy, mid)) lo = mid; else hi = mid; }
    if (lo > best.sc) best = { sc: lo, x: gx, y: gy };
  }
  best.sc *= zoom;
  const mid: Point = [region.reduce((a, p) => a + p[0], 0) / region.length, region.reduce((a, p) => a + p[1], 0) / region.length];
  for (let k = 1; k >= 0; k -= 0.05) { const x = best.x + (mid[0] - best.x) * k, y = best.y + (mid[1] - best.y) * k; if (fits(x, y, best.sc)) { best.x = x; best.y = y; break; } }
  const to = (p: Point): Point => [best.x + (p[0] - x0) * best.sc, best.y + (p[1] - y0) * best.sc];
  return Object.assign(points.map(to), { to });
}
const simplify = (pts: Point[], tol: number): Point[] => { if (pts.length < 3) return pts; let far = 0, at = 0; for (let i = 1; i < pts.length - 1; i++) { const d = segD(pts[i][0], pts[i][1], pts[0], pts[pts.length - 1]); if (d > far) { far = d; at = i; } } return far <= tol ? [pts[0], pts[pts.length - 1]] : [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)]; };
const smooth = (pts: Point[], n: number) => { for (let k = 0; k < n; k++) { const o: Point[] = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]]; o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } o.push(pts[pts.length - 1]); pts = o; } return pts; };

const LAND = JSON.parse(fs.readFileSync(new URL('./land.json', import.meta.url), 'utf8')) as Point[][];
function landIn(face: Point[], to: (p: Point) => Point): Land[] {
  const fx = face.map((p) => p[0]), fy = face.map((p) => p[1]), box = [Math.min(...fx), Math.min(...fy), Math.max(...fx), Math.max(...fy)];
  return LAND.map((ring) => { const pts = ring.map(to), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { pts, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }; })
    .filter((r) => r.box[0] < box[2] && r.box[2] > box[0] && r.box[1] < box[3] && r.box[3] > box[1]);
}

type FaceOptions = { routes?: Point[][] | null; dotted?: Point[][]; accents?: Point[]; stops?: Point[]; hole?: { x: number; y: number; r: number } | null; quiet: number[][]; land?: Land[] | null };
function facePieces(key: keyof typeof FACE, { routes, dotted = [], accents = [], stops = [], hole, quiet, land }: FaceOptions) {
  const onLand = (x: number, y: number) => land!.some((r) => x >= r.box[0] && x <= r.box[2] && y >= r.box[1] && y <= r.box[3] && inPoly(r.pts, x, y));
  const route = (routes && routes.length) || dotted.length ? [...(routes || []), ...dotted] : null;
  const face = FACE[key], byFill: Record<string, string[]> = {};
  const put = (t: Point[], mx: number, my: number, fill: string) => { (byFill[fill] ||= []).push('M' + t.map((p) => [mx + (p[0] - mx) * 0.87, my + (p[1] - my) * 0.87].map((z) => z.toFixed(1)).join(' ')).join('L') + 'Z'); };
  const quietK = (x: number, y: number) => { let k = 0; for (const [qx, qy, qw, qh] of quiet) { const dx = Math.max(qx - x, 0, x - qx - qw), dy = Math.max(qy - y, 0, y - qy - qh); k = Math.max(k, 1 - Math.min(1, Math.hypot(dx, dy) / 22)); } return k; };
  function piece(t: Point[], depth: number, seed: number): void {
    const mx = (t[0][0] + t[1][0] + t[2][0]) / 3, my = (t[0][1] + t[1][1] + t[2][1]) / 3, size = S0 / 2 ** depth, r = h32(seed);
    const d = route ? Math.min(...route.map((l) => lineD(l, mx, my))) : 1e9, dOut = edgeD(OUTER, mx, my), dIn = edgeD(INNER, mx, my);
    const dAcc = Math.min(1e9, ...accents.map((s) => Math.hypot(mx - s[0], my - s[1]))), dStop = Math.min(1e9, ...stops.map((s) => Math.hypot(mx - s[0], my - s[1])));
    const hx = hole ? Math.abs(mx - hole.x) : 0, dHole = hole ? Math.max(hx / H3, hx * 0.57735 + Math.abs(my - hole.y)) * H3 - hole.r * H3 : 1e9;
    const fine = Math.min(d * 1.6, dAcc - 4, dStop - 2, Math.max(0, dHole) * (depth < 4 ? 1 : 1e9) + (depth < 4 ? 0 : 1e9)), coarse = Math.min(dOut - 5, dIn - 2);
    const coast = land && depth < 5 && new Set([...t, [mx, my]].map((q) => onLand(q[0], q[1]))).size > 1;
    if (coast || (depth < 5 && fine < size * 1.15) || (depth < 3 && (coarse < size * 1.15 || r < [0.8, 0.55, 0.3][depth]))) {
      const m = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [a, b, c] = t, ab = m(a, b), bc = m(b, c), ca = m(c, a);
      [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]].forEach((s, i) => piece(s, depth + 1, seed * 4 + i + 1)); return;
    }
    if (!inPoly(face, mx, my) || dHole < -1) return;
    const r2 = h32(seed + 77), q = quietK(mx, my);
    if (dOut < 9) return put(t, mx, my, rgb(LP, 0.72 + 0.3 * r));
    if (dIn < 4) return put(t, mx, my, rgb(LP, 0.5 + 0.2 * r));
    const under = 1 - 0.2 * q;
    if (dAcc < 6.5) return put(t, mx, my, rgb(LA, (0.85 + 0.3 * r) * under));
    if (dStop < 3.6) return put(t, mx, my, rgb(LP, (1.15 + 0.15 * r) * under));
    const dSolid = routes && routes.length ? Math.min(...routes.map((l) => lineD(l, mx, my))) : 1e9;
    if (dSolid < 1.5) return put(t, mx, my, rgb(LP, (0.92 + 0.25 * r) * under));
    for (const l of dotted) if (lineD(l, mx, my) < 1.9 && Math.floor(along(l, mx, my) / 7) % 2 === 0) return put(t, mx, my, rgb(LP, (1.0 + 0.2 * r) * under));
    if (r2 < 0.14 && d > 12 && q < 0.2) return;
    const sea = land && !onLand(mx, my);
    if (sea && r2 < 0.6) return;
    const shore = land && !sea && depth >= 5 && t.some((c) => !onLand(c[0], c[1]));
    const glow = route ? 0.55 * Math.exp(-dSolid / 9) + 0.25 * Math.exp(-d / 6) : Math.exp(-Math.max(0, dHole) / 22) * 0.55;
    put(t, mx, my, rgb(mix(P, LP, glow), ((sea ? 0.11 : shore ? 0.62 : land ? 0.38 : 0.2) + 0.12 * r + 0.72 * glow) * (1 - 0.45 * q)));
  }
  for (let a = -6; a <= 6; a++) for (let b = -10; b <= 10; b++) {
    const Q = (u: number, v: number): Point => [cx + u * h0, cy + (v + u / 2) * S0];
    [[Q(a, b), Q(a + 1, b), Q(a, b + 1)], [Q(a + 1, b), Q(a + 1, b + 1), Q(a, b + 1)]].forEach((t, k) => piece(t, 0, (a + 40) * 997 + (b + 40) * 2 + k + 1));
  }
  return Object.entries(byFill).map(([f, d]) => `<path fill="${f}" d="${d.join('')}"/>`).join('');
}

const F = `font-family="'Space Grotesk',sans-serif"`, U = `font-family="Inter,system-ui,sans-serif"`;
const label = (x: number, y: number, t: string, a = 'start') => `<text x="${x}" y="${y}" text-anchor="${a}" ${U} font-size="10" fill="#9aa0ad" letter-spacing="1.3">${esc(t)}</text>`;
const title = (x: number, y: number, t: string, a = 'start') => `<text x="${x}" y="${y}" text-anchor="${a}" ${F} font-size="21" fill="#e8e9ec">${esc(t)}</text>`;
const small = (x: number, y: number, t: string, fill = '#9aa0ad', a = 'start') => `<text x="${x}" y="${y}" text-anchor="${a}" ${U} font-size="10.5" fill="${fill}">${esc(t)}</text>`;
const wrap = (t: string, n: number) => t.split(' ').reduce((l: string[], w) => { const c = l[l.length - 1]; if (c && (c + ' ' + w).length <= n) l[l.length - 1] = c + ' ' + w; else l.push(w); return l; }, []);
const file = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}"><rect width="${BOX}" height="${BOX}" fill="#121418"/>${body}</svg>\n`;
const spoken = (svg: string, name: string) => [...[...svg.matchAll(/<text([^>]*)>(.*?)<\/text>/g)].slice(0, -1)
  .map((m) => ({ title: m[1].includes('font-size="21"'), t: m[2].replace(/<tspan/g, ' <tspan').replace(/<[^>]+>/g, '').trim() }))
  .reduce((l: string[], x, k, all) => { if (k && x.title && all[k - 1].title) l[l.length - 1] += ' ' + x.t; else l.push(x.t); return l; }, [])
  .map((t) => (/[a-z]/.test(t) ? t : t[0] + t.slice(1).toLowerCase())), esc(name)].join('. ');
const card = (key: string, href: string, name: string, text: string) => `    <a class="ewin" href="${esc(href)}"><span class="vh">${spoken(text, name)}</span><span class="card"><img src="/assets/embeds/${key}.svg" alt=""><svg viewBox="0 0 ${BOX} ${BOX}" aria-hidden="true" style="paint-order:stroke;stroke:#121418;stroke-width:3px;stroke-linejoin:round">${text}</svg></span></a>`;

export function buildCards({ music: m, travel: t, run: r }: Embeds, dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const out = {} as Cards;

  const hole = { x: cx - 96, y: cy - 150, r: 64 }, s = 9, sh = s * H3;
  const hex = [...Array(6)].map((_, k) => { const a = Math.PI / 3 * k - Math.PI / 2; return [hole.x + hole.r * Math.cos(a), hole.y + hole.r * Math.sin(a)]; });
  const artFile = path.join(dir, 'music.jpg');
  const art = m && fs.existsSync(artFile) ? `<defs><clipPath id="a"><path d="M${hex.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}Z"/></clipPath><pattern id="s" width="${sh * 2}" height="${s}" patternUnits="userSpaceOnUse" patternTransform="translate(${hole.x} ${hole.y})"><path d="M0 0L${sh} ${s / 2}L0 ${s}M${sh} ${s / 2}L${sh * 2} 0M${sh} ${s / 2}L${sh * 2} ${s}M0 0V${s}M${sh} 0V${s}" stroke="#15171a" stroke-width="1.2" fill="none"/></pattern></defs><g clip-path="url(#a)"><image href="data:image/jpeg;base64,${fs.readFileSync(artFile).toString('base64')}" x="${hole.x - hole.r}" y="${hole.y - hole.r}" width="${2 * hole.r}" height="${2 * hole.r}" preserveAspectRatio="xMidYMid slice"/><rect x="${hole.x - hole.r}" y="${hole.y - hole.r}" width="${2 * hole.r}" height="${2 * hole.r}" fill="url(#s)" opacity=".8"/></g>` : '';
  fs.writeFileSync(path.join(dir, 'music.svg'), file(facePieces('music', { hole: art ? hole : null, quiet: [[cx - 30, cy - 196, 190, 100]] }) + art));
  const mx = cx - 18;
  out.music = m
    ? card('music', m.url, `Listen to ${m.title} on Apple Music`, label(mx, cy - 174, 'NEWEST RELEASE') + title(mx, cy - 149, m.title) + small(mx, cy - 131, `${m.artist} · ${m.kind} · ${m.year}`) + small(mx, cy - 111, 'Apple Music →', '#b9bec9'))
    : card('music', 'https://music.apple.com/', 'My music on Apple Music', label(mx, cy - 176, 'MUSIC') + title(mx, cy - 148, 'My music') + small(mx, cy - 106, 'Apple Music →', '#b9bec9'));

  let stopsT: Point[] = [], landT: Land[] | null = null;
  const routeT: Point[][] = [], flightsT: Point[][] = [];
  if (t && t.steps.length > 1) {
    const lat0 = t.steps.reduce((a, p) => a + p.lat, 0) / t.steps.length, k = Math.cos(lat0 * Math.PI / 180), xy = (p: LatLon): Point => [p.lon * k, -p.lat];
    const legs = (t.paths && t.paths.length ? t.paths : [{ points: t.steps } as Leg]).map((l) => ({ flight: l.flight, pts: l.flight ? arc(xy(l.points[0]), xy(l.points[l.points.length - 1])) : l.points.map(xy) }));
    const all = fitIn([...t.steps.map(xy), ...legs.flatMap((l) => l.pts)], FACE.travel, 24, 0.8);
    stopsT = all.slice(0, t.steps.length);
    landT = landIn(FACE.travel, (lonLat) => all.to([lonLat[0] * k, -lonLat[1]]));
    let at = t.steps.length;
    for (const l of legs) {
      const pts = all.slice(at, at + l.pts.length); at += l.pts.length;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      if (Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 9) continue;
      (l.flight ? flightsT : routeT).push(l.flight ? pts : smooth(simplify(pts, 1.5), 2));
    }
  }
  fs.writeFileSync(path.join(dir, 'travel.svg'), file(facePieces('travel', { routes: routeT, dotted: flightsT, land: landT, accents: stopsT.length ? [stopsT[0], stopsT[stopsT.length - 1]] : [], stops: stopsT.slice(1, -1), quiet: [[cx - 190, cy + 17, 120, 114]] })));
  const tx = cx - 130, M = 'middle';
  if (t) { const lines = wrap(t.title, 10).slice(0, 2); out.travel = card('travel', t.url, `Follow ${t.title} on Polarsteps`, label(tx, cy + 35, 'NEWEST TRIP', M) + lines.map((l, i) => title(tx, cy + 59 + i * 23, l, M)).join('') + small(tx, cy + 77 + (lines.length - 1) * 23, `${t.days} days · ${t.steps.length} steps`, undefined, M) + small(tx, cy + 97 + (lines.length - 1) * 23, 'Polarsteps →', '#b9bec9', M)); }
  else out.travel = card('travel', 'https://www.polarsteps.com/', 'My travels on Polarsteps', label(tx, cy + 35, 'TRAVEL', M) + title(tx, cy + 59, 'My travels', M) + small(tx, cy + 85, 'Polarsteps →', '#b9bec9', M));

  let routeR: Point[] | null = null;
  if (r && r.route.length > 1) {
    const kr = Math.cos(r.route[0].lat * Math.PI / 180), xy = (p: LatLon): Point => [p.lon * kr, -p.lat], fitted = fitIn(r.route.map(xy), FACE.run, 24, 0.75);
    routeR = smooth(simplify(fitted, 2.5), 3);
  }
  fs.writeFileSync(path.join(dir, 'run.svg'), file(facePieces('run', { routes: routeR ? [routeR] : null, accents: routeR ? [routeR[routeR.length - 1]] : [], stops: routeR ? [routeR[0]] : [], quiet: [[cx + 62, cy + 17, 136, 118]] })));
  const rx = cx + 130;
  out.run = r
    ? card('run', r.url, 'See my latest run on Strava', label(rx, cy + 35, 'LATEST RUN', M) + `<text x="${rx}" y="${cy + 71}" text-anchor="middle" ${F} font-size="38" fill="#e8e9ec" letter-spacing="-1">${esc(r.km)}<tspan font-size="16" dx="4" fill="#9aa0ad">km</tspan></text>` + small(rx, cy + 89, `${r.date} · ${r.time}`, undefined, M) + small(rx, cy + 103, `${r.pace} · ${r.up} m up`, undefined, M) + small(rx, cy + 123, 'Strava →', '#b9bec9', M))
    : card('run', 'https://www.strava.com/', 'My running on Strava', label(rx, cy + 35, 'RUNNING', M) + title(rx, cy + 59, 'My runs', M) + small(rx, cy + 85, 'Strava →', '#b9bec9', M));
  return out;
}
