import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';

export type Point = [number, number];
export type Poly = Point[];
export type Shape = 'hexagon' | 'triangle' | 'rhombus' | 'trapezoid';
export type FormSpec = { shape: Shape; at: Point; size: number; focus?: boolean; absent?: boolean; to?: number };
export type SceneForm = { focus?: boolean; absent?: boolean; poly: Poly; dashes?: Poly[]; cut?: Poly };
export type Scene = { forms: SceneForm[]; trails: Poly[] };

const H3 = 0.8660254;
const BG = [21, 23, 26], P = [90, 111, 165], A = [160, 80, 112], LP = [128, 150, 232], LA = [226, 120, 160];
const h32 = (x: number) => { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
const inPoly = (p: Poly, x: number, y: number) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
const segD = (x: number, y: number, a: Point, b: Point) => { const bx = b[0] - a[0], by = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * bx + (y - a[1]) * by) / (bx * bx + by * by))); return Math.hypot(x - a[0] - bx * t, y - a[1] - by * t); };
const edgeD = (p: Poly, x: number, y: number) => { let d = 1e9; for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, segD(x, y, p[j], p[i])); return d; };
const mean = (p: Poly): Point => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
const rgb = (c: number[], l: number) => `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(255, v * l)) / 5) * 5).join(',')})`;
const over = (c: number[], a: number) => c.map((v, i) => v * a + BG[i] * (1 - a));

const R = 300, BOX = 2 * R, UNIT = R / 16;
const pt = (i: number, j: number): Point => [R + i * H3 * UNIT, R + (j + i / 2) * UNIT];
const HEX = [[0, -16], [16, -16], [16, 0], [0, 16], [-16, 16], [-16, 0]].map(([i, j]) => pt(i, j));
const grid = ([x, y]: Point): Point => [2 * x, y - x];
const SHAPES: Record<Shape, (n: number) => Poly> = {
  hexagon: (n) => [[0, -n], [n, -n], [n, 0], [0, n], [-n, n], [-n, 0]],
  triangle: (n) => [[0, 0], [n, 0], [0, n]],
  rhombus: (n) => [[0, 0], [n, 0], [n, n], [0, n]],
  trapezoid: (n) => [[0, 0], [n, 0], [n, n], [0, 2 * n]],
};
const anchors: Record<string, Poly> = {};
function anchor(shape: Shape, n: number): Poly {
  if (anchors[shape + n]) return anchors[shape + n];
  const corners = SHAPES[shape](n);
  let best: { d: number; i: number; j: number } | null = null;
  for (let i = -8; i <= 8; i += 0.5) for (let j = -8; j <= 8; j += 0.5) {
    const m = mean(corners.map(([a, b]) => pt(a + i, b + j))), d = Math.hypot(m[0] - R, m[1] - R);
    if (!best || d < best.d - 1e-9) best = { d, i, j };
  }
  return (anchors[shape + n] = corners.map(([a, b]): Point => [a + best!.i, b + best!.j]));
}
const MARGIN = 1.5 * UNIT, GAP = UNIT;
const FIT = 2 * UNIT, ROOM = 2 * UNIT;
const scaleAbout = (p: Poly, c: Point, k: number) => p.map(([x, y]): Point => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k]);
const near = (a: Poly, b: Poly) => Math.min(...a.map((p) => edgeD(b, p[0], p[1])), ...b.map((p) => edgeD(a, p[0], p[1])));
const within = (a: Poly, b: Poly) => a.every((p) => inPoly(b, p[0], p[1]));

export function layout(forms: FormSpec[]) {
  const at = forms.map((f) => grid(f.at));
  const place = (k: number, g: number): Poly[] => {
    const sc = forms.map((f, n) => anchor(f.shape, Math.round(f.size * k * g * 2) / 2).map(([a, b]) => [a + at[n][0] * k, b + at[n][1] * k])), all = sc.flat().map(([i, j]) => pt(i, j));
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const dx = Math.round((R - (Math.min(...xs) + Math.max(...xs)) / 2) / (H3 * UNIT)) / 2, dy = Math.round(2 * (R - (Math.min(...ys) + Math.max(...ys)) / 2) / UNIT) / 2;
    const [di, dj] = [2 * dx, dy - dx];
    return sc.map((st) => st.map(([i, j]) => pt(i + di, j + dj)));
  };
  const problems: string[] = [];
  const polys1 = place(1, 1), parent = forms.map(() => -1), apart: Record<string, number> = {};
  polys1.forEach((a, k) => polys1.forEach((b, m) => {
    if (m <= k) return;
    const d = near(a, b);
    if (within(b, a) && d >= GAP - 0.01) parent[m] = k;
    else if (within(a, b) && d >= GAP - 0.01) parent[k] = m;
    else if (d < GAP - 0.01 || a.some((p) => inPoly(b, ...p)) || b.some((p) => inPoly(a, ...p))) problems.push(`forms ${k + 1} and ${m + 1} touch or overlap`);
    else apart[k + ',' + m] = d;
  }));
  forms.forEach((f, k) => { if (f.to != null && (f.to < 1 || f.to > forms.length || f.to === k + 1)) problems.push(`form ${k + 1}: to must name another form, 1 to ${forms.length}`); });
  const clear = (ps: Poly[], m: number) => ps.flat().every((p) => inPoly(HEX, p[0], p[1]) && edgeD(HEX, p[0], p[1]) >= m - 0.01);
  if (!clear(polys1, MARGIN)) problems.push('the forms reach too close to the rim');
  const fits = (ps: Poly[], k: number) => clear(ps, FIT) && Object.entries(apart).every(([key, d]) => { const [a, b] = key.split(',').map(Number); return near(ps[a], ps[b]) >= Math.min(ROOM, d * k) - 0.01 && !ps[a].some((p) => inPoly(ps[b], ...p)) && !ps[b].some((p) => inPoly(ps[a], ...p)); })
    && parent.every((pa, n) => pa < 0 || (within(ps[n], ps[pa]) && near(ps[n], ps[pa]) >= GAP - 0.01));
  let polys = polys1, scale = 1, grow = 1;
  if (!problems.length) {
    for (let k = 4; k > 1; k -= 0.5) { const ps = place(k, 1); if (fits(ps, k)) { polys = ps; scale = k; break; } }
    for (let g = 3; g > 1.01; g -= 0.05) { const ps = place(scale, g); if (fits(ps, scale)) { polys = ps; grow = g; break; } }
  }
  const out = forms.map((f, k): SceneForm => {
    const poly = polys[k], c = mean(poly), r = Math.min(...poly.map((p, i) => segD(c[0], c[1], p, poly[(i + 1) % poly.length])));
    return { focus: f.focus, absent: f.absent, poly, dashes: f.absent ? dashes(poly) : undefined, cut: parent[k] >= 0 ? scaleAbout(poly, c, (r + UNIT / 2) / r) : undefined };
  });
  const trails = forms.flatMap((f, k): Poly[] => {
    if (f.to == null || problems.length) return [];
    const a = mean(out[k].poly), b = mean(out[f.to - 1].poly), at = (t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    let t0 = 0, t1 = 1;
    for (let t = 0; t <= 1; t += 0.002) { const [x, y] = at(t); if (inPoly(out[k].poly, x, y)) t0 = t; }
    for (let t = 1; t >= 0; t -= 0.002) { const [x, y] = at(t); if (inPoly(out[f.to - 1].poly, x, y)) t1 = t; }
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / len * 0.45 * UNIT, ny = (b[0] - a[0]) / len * 0.45 * UNIT;
    const p = at(t0 + UNIT / 2 / len), q = at(t1 - UNIT / 2 / len);
    return [[[p[0] + nx, p[1] + ny], [q[0] + nx, q[1] + ny], [q[0] - nx, q[1] - ny], [p[0] - nx, p[1] - ny]]];
  });
  const unit = (p: Poly) => p.map(([x, y]): Point => [+(x / BOX).toFixed(4), +(y / BOX).toFixed(4)]);
  return {
    forms: out.map((f): SceneForm => ({ ...f, poly: unit(f.poly), cut: f.cut && unit(f.cut), dashes: f.dashes && f.dashes.map(unit) })),
    trails: trails.map(unit),
    scale: scale * grow,
    problems,
  };
}

function dashes(poly: Poly) {
  const c = mean(poly), out: Poly[] = [];
  poly.forEach((p, k) => {
    const q = poly[(k + 1) % poly.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]), m = Math.round(len / (UNIT / 2));
    let nx = -(q[1] - p[1]) / len, ny = (q[0] - p[0]) / len;
    if ((c[0] - p[0]) * nx + (c[1] - p[1]) * ny < 0) { nx = -nx; ny = -ny; }
    const w = 0.85 * UNIT, at = (t: number): Point => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (let s = 0; s < m; s += 2) { const a = at(s / m), b = at((s + 1) / m); out.push([a, b, [b[0] + nx * w, b[1] + ny * w], [a[0] + nx * w, a[1] + ny * w]]); }
  });
  return out;
}

const FORM_DEPTH = 5, RIM = 11;
function pieces({ forms, trails }: Scene, { cells = HEX.map((v, k): Poly => [[R, R], v, HEX[(k + 1) % 6]]), rim = true }: { cells?: Poly[]; rim?: boolean } = {}) {
  const px = (p: Poly) => p.map(([x, y]): Point => [x * BOX, y * BOX]);
  const fs = forms.map((f) => ({ f, poly: px(f.poly), cut: f.cut && px(f.cut), dashes: f.dashes && f.dashes.map(px) })), ts = trails.map(px);
  function at(x: number, y: number): { key: string; g?: (typeof fs)[number]; trail?: boolean } {
    for (let k = fs.length - 1; k >= 0; k--) {
      const g = fs[k];
      if (inPoly(g.poly, x, y)) return g.f.absent ? (g.dashes!.some((d) => inPoly(d, x, y)) ? { key: 'd' + k, g } : { key: 'i' + k }) : { key: 'f' + k, g };
      if (g.cut && inPoly(g.cut, x, y)) return { key: 'c' + k };
    }
    return ts.some((t) => inPoly(t, x, y)) ? { key: 't', trail: true } : { key: '' };
  }
  const outlines = fs.map((g) => g.poly);
  const byFill: Record<string, string[]> = {};
  const put = (t: Poly, mx: number, my: number, fill: string, k = 0.86) => { (byFill[fill] ||= []).push('M' + t.map((q) => [mx + (q[0] - mx) * k, my + (q[1] - my) * k].map((z) => z.toFixed(1)).join(' ')).join('L') + 'Z'); };
  function piece(t: Poly, depth: number, seed: number): void {
    const [mx, my] = mean(t), r = h32(seed), r2 = h32(seed + 77);
    const probe = t.map((q) => [q[0] * 0.92 + mx * 0.08, q[1] * 0.92 + my * 0.08]).concat([[mx, my]]);
    const keys = probe.map(([x, y]) => at(x, y).key), dRim = rim ? Math.min(...probe.map(([x, y]) => edgeD(HEX, x, y))) : Infinity;
    const dForm = Math.min(1e9, ...outlines.map((p) => (inPoly(p, mx, my) ? 0 : edgeD(p, mx, my))));
    const mixed = keys.some((k) => k !== keys[0]), busy = keys[0] !== '' || dRim < RIM;
    const split = (mixed || busy) ? depth < FORM_DEPTH : depth < 2 || (depth < 4 && r < [1, 1, 0.55, 0.3][depth]) || (depth < 5 && dForm < [0, 0, 3, 2, 1.2][depth] * UNIT && r < 0.8);
    if (split) {
      const m = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [a, b, c] = t, ab = m(a, b), bc = m(b, c), ca = m(c, a);
      [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]].forEach((s, i) => piece(s, depth + 1, seed * 4 + i + 1));
      return;
    }
    const lit = Math.min(1.12, Math.max(0.88, 1 + 0.12 * ((R - mx) + (R - my)) / BOX)), here = at(mx, my);
    if (rim && edgeD(HEX, mx, my) < RIM) return put(t, mx, my, rgb(LP, (0.48 + 0.2 * r) * lit));
    if (here.g) { const f = here.g.f; return put(t, mx, my, rgb(f.focus ? LA : LP, (f.absent ? 0.9 : 0.74 + 0.26 * r) * lit)); }
    if (here.trail) return put(t, mx, my, rgb(LP, (0.58 + 0.14 * r) * lit));
    if (r2 < 0.1 && dRim > RIM * 2 && dForm > UNIT) return;
    const hue = 0.35 * (0.5 + 0.5 * Math.sin(mx * 0.011 + my * 0.006 + 1.3)) * (0.5 + 0.5 * Math.sin(my * 0.009 - mx * 0.004));
    const glow = 0.28 * Math.exp(-dForm / (2.5 * UNIT));
    put(t, mx, my, rgb(over(r2 > 0.97 && depth >= 4 ? A : P.map((v, i) => v + (A[i] - v) * hue), 0.4 + glow), (0.62 + 0.4 * r) * lit), depth < 3 ? 0.93 : 0.88);
  }
  cells.forEach((t, k) => piece(t, 0, k + 1));
  return Object.entries(byFill).map(([f, d]) => `<path fill="${f}" d="${d.join('')}"/>`).join('');
}

export function sceneSvg(scene?: Scene | null) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}">${pieces(scene || { forms: [], trails: [] })}</svg>\n`;
}

function lattice([x0, y0, x1, y1]: number[]) {
  const e1 = [0, -R], e2 = [R * H3, -R / 2], v = (a: number, b: number): Point => [R + a * e1[0] + b * e2[0], R + a * e1[1] + b * e2[1]];
  const own = HEX.map((p, k): Poly => [[R, R], p, HEX[(k + 1) % 6]]), key = (t: Poly) => mean(t).map((z) => Math.round(z)).join(',');
  const seen = new Set(own.map(key)), out = [...own], n = Math.ceil(Math.max(x1 - x0, y1 - y0) / R) + 2;
  for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) for (const t of [[v(a, b), v(a + 1, b), v(a, b + 1)], [v(a + 1, b), v(a, b + 1), v(a + 1, b + 1)], [v(a, b), v(a, b + 1), v(a - 1, b + 1)], [v(a, b), v(a - 1, b + 1), v(a - 1, b)]]) {
    const xs = t.map((p) => p[0]), ys = t.map((p) => p[1]);
    if (Math.max(...xs) < x0 || Math.min(...xs) > x1 || Math.max(...ys) < y0 || Math.min(...ys) > y1 || seen.has(key(t))) continue;
    seen.add(key(t)); out.push(t);
  }
  return out;
}

export function sceneWide(scene: Scene | null | undefined, { width = 1200, height = 630, wide = 0.7, tall = 0.8 }: { width?: number; height?: number; wide?: number; tall?: number } = {}) {
  let cx = R, cy = R, k = BOX / (height * tall);
  if (scene?.forms.length) {
    const ps = scene.forms.flatMap((f) => f.poly).map(([x, y]) => [x * BOX, y * BOX]), xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
    const m = 3 * UNIT, x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
    k = Math.max((x1 - x0 + 2 * m) / (width * wide), (y1 - y0 + 2 * m) / (height * tall));
  }
  const w = width * k, h = height * k, box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${box[0].toFixed(1)} ${box[1].toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}"><rect x="${box[0]}" y="${box[1]}" width="${w}" height="${h}" fill="rgb(${BG.join(',')})"/>${pieces(scene || { forms: [], trails: [] }, { cells: lattice(box), rim: false })}</svg>\n`;
}

const ICON = fileURLToPath(new URL('./static/favicon.svg', import.meta.url));
export async function sceneJpg(scene: Scene | null | undefined, { width = 1200, height = 630, icon = fs.readFileSync(ICON) }: { width?: number; height?: number; icon?: Buffer | null } = {}) {
  const layers: OverlayOptions[] = [];
  if (icon) {
    const size = 96, inset = 72, hex = Buffer.from(icon.toString().replace(/<rect [^>]*\/>/, ''));
    layers.push({ input: await sharp(hex, { density: 72 * size / 100 }).resize(size, size).png().toBuffer(), left: width - inset - size, top: height - inset - size });
  }
  return sharp(Buffer.from(sceneWide(scene, { width, height }))).composite(layers).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
}
