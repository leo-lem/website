// The home page's Off the clock hexagon: three flat faces (music, travel, running), drawn at build time in the
// fractal's style. Each face is an SVG of pieces on the fractal's triangle grid, written as its own file, with
// its text as HTML-side SVG over it so the site's fonts apply. Everything stands upright; nothing is a cube.
// All three share one 600 x 600 box with the hexagon (radius 300) in its middle, as src/home.js places them.
import fs from 'node:fs';
import path from 'node:path';

const H3 = 0.8660254, BOX = 600, cx = 300, cy = 300, R = 300, S0 = 60, h0 = S0 * H3;
const P = [90, 111, 165], LP = [128, 150, 232], LA = [226, 120, 160];
const h32 = (x) => { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c, l) => `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(255, v * l)) / 6) * 6).join(',')})`; // few shades, few paths
const V = [...Array(6)].map((_, k) => { const a = Math.PI / 3 * k - Math.PI / 2; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
const C = [cx, cy], FACE = { music: [V[5], V[0], V[1], C], travel: [V[5], C, V[3], V[4]], run: [C, V[1], V[2], V[3]] };
const OUTER = V.map((v, i) => [v, V[(i + 1) % 6]]), INNER = [[C, V[1]], [C, V[3]], [C, V[5]]];
const inPoly = (p, x, y) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
const segD = (x, y, a, b) => { const bx = b[0] - a[0], by = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * bx + (y - a[1]) * by) / (bx * bx + by * by || 1))); return Math.hypot(x - a[0] - bx * t, y - a[1] - by * t); };
const lineD = (pts, x, y) => { let d = 1e9; for (let i = 1; i < pts.length; i++) d = Math.min(d, segD(x, y, pts[i - 1], pts[i])); return d; };
// How far along a line its nearest point lies, for dotted lines.
const along = (pts, x, y) => { let best = 1e9, at = 0, run = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], bx = b[0] - a[0], by = b[1] - a[1], len = Math.hypot(bx, by), t = Math.max(0, Math.min(1, ((x - a[0]) * bx + (y - a[1]) * by) / (len * len || 1))), d = Math.hypot(x - a[0] - bx * t, y - a[1] - by * t); if (d < best) { best = d; at = run + t * len; } run += len; } return at; };
// A flight is an arc from a to b, nearly a semicircle, bent to the left of its direction: the way out and the
// way back open up.
const arc = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], m = [(a[0] + b[0]) / 2 + dy * 0.85, (a[1] + b[1]) / 2 - dx * 0.85]; return [...Array(25)].map((_, i) => { const t = i / 24, u = 1 - t; return [u * u * a[0] + 2 * u * t * m[0] + t * t * b[0], u * u * a[1] + 2 * u * t * m[1] + t * t * b[1]]; }); };
const edgeD = (edges, x, y) => Math.min(...edges.map(([a, b]) => segD(x, y, a, b)));
// Places points as large as they go inside a region, keeping their proportions and a margin to its edges:
// tries every centre on a grid and keeps the one that allows the largest scale, then draws it at `zoom` of that,
// as near the region's middle as it fits. The result carries the mapping
// it used as .to, so a background can be drawn in the same space.
function fitIn(points, region, margin, zoom = 1) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]), x0 = (Math.min(...xs) + Math.max(...xs)) / 2, y0 = (Math.min(...ys) + Math.max(...ys)) / 2;
  const step = Math.max(1, Math.floor(points.length / 90)), probe = points.filter((_, i) => i % step === 0).map((p) => [p[0] - x0, p[1] - y0]);
  const edges = region.map((p, i) => [p, region[(i + 1) % region.length]]), rx = region.map((p) => p[0]), ry = region.map((p) => p[1]);
  const fits = (cx0, cy0, sc) => probe.every((p) => { const x = cx0 + p[0] * sc, y = cy0 + p[1] * sc; return inPoly(region, x, y) && edgeD(edges, x, y) >= margin; });
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9), most = (Math.max(...rx) - Math.min(...rx) + Math.max(...ry) - Math.min(...ry)) / span;
  let best = { sc: 0, x: (Math.min(...rx) + Math.max(...rx)) / 2, y: (Math.min(...ry) + Math.max(...ry)) / 2 };
  for (let gx = Math.min(...rx); gx <= Math.max(...rx); gx += 6) for (let gy = Math.min(...ry); gy <= Math.max(...ry); gy += 6) {
    if (!fits(gx, gy, best.sc * 1.02 || 1e-9)) continue; // cannot beat the best so far
    let lo = best.sc, hi = most;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (fits(gx, gy, mid)) lo = mid; else hi = mid; }
    if (lo > best.sc) best = { sc: lo, x: gx, y: gy };
  }
  // Drawn a little smaller than the largest fit (zoom), which frees room to move it toward the region's middle.
  best.sc *= zoom;
  const mid = [region.reduce((a, p) => a + p[0], 0) / region.length, region.reduce((a, p) => a + p[1], 0) / region.length];
  for (let k = 1; k >= 0; k -= 0.05) { const x = best.x + (mid[0] - best.x) * k, y = best.y + (mid[1] - best.y) * k; if (fits(x, y, best.sc)) { best.x = x; best.y = y; break; } }
  const to = (p) => [best.x + (p[0] - x0) * best.sc, best.y + (p[1] - y0) * best.sc], out = points.map(to);
  out.to = to; return out;
}
// Drops points that don't change a route's shape (Douglas-Peucker), then rounds every corner (Chaikin).
const simplify = (pts, tol) => { if (pts.length < 3) return pts; let far = 0, at = 0; for (let i = 1; i < pts.length - 1; i++) { const d = segD(pts[i][0], pts[i][1], pts[0], pts[pts.length - 1]); if (d > far) { far = d; at = i; } } return far <= tol ? [pts[0], pts[pts.length - 1]] : [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)]; };
const smooth = (pts, n) => { for (let k = 0; k < n; k++) { const o = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]]; o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } o.push(pts[pts.length - 1]); pts = o; } return pts; };

// One face's pieces. The grid splits finer toward the rim, the seams and whatever the face shows (a route, its
// stops, the artwork); pieces light up toward the route and go dark under the text.
// Land outlines (Natural Earth, public domain; outer rings as [lon, lat]) for the map behind a trip.
const LAND = JSON.parse(fs.readFileSync(new URL('./land.json', import.meta.url), 'utf8'));
// The rings that reach into a face, mapped into the card's space, each with its bounding box.
function landIn(face, to) {
  const fx = face.map((p) => p[0]), fy = face.map((p) => p[1]), box = [Math.min(...fx), Math.min(...fy), Math.max(...fx), Math.max(...fy)];
  return LAND.map((ring) => { const pts = ring.map(to), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { pts, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }; })
    .filter((r) => r.box[0] < box[2] && r.box[2] > box[0] && r.box[1] < box[3] && r.box[3] > box[1]);
}

// A face may have a map behind it: `land` as rings, everything else being sea.
function facePieces(key, { routes, dotted = [], accents = [], stops = [], hole, quiet, land }) {
  const onLand = (x, y) => land.some((r) => x >= r.box[0] && x <= r.box[2] && y >= r.box[1] && y <= r.box[3] && inPoly(r.pts, x, y));
  const route = (routes && routes.length) || dotted.length ? [...(routes || []), ...dotted] : null;
  const face = FACE[key], byFill = {};
  const put = (t, mx, my, fill) => { (byFill[fill] ||= []).push('M' + t.map((p) => [mx + (p[0] - mx) * 0.87, my + (p[1] - my) * 0.87].map((z) => z.toFixed(1)).join(' ')).join('L') + 'Z'); };
  const quietK = (x, y) => { let k = 0; for (const [qx, qy, qw, qh] of quiet) { const dx = Math.max(qx - x, 0, x - qx - qw), dy = Math.max(qy - y, 0, y - qy - qh); k = Math.max(k, 1 - Math.min(1, Math.hypot(dx, dy) / 22)); } return k; };
  function piece(t, depth, seed) {
    const mx = (t[0][0] + t[1][0] + t[2][0]) / 3, my = (t[0][1] + t[1][1] + t[2][1]) / 3, size = S0 / 2 ** depth, r = h32(seed);
    const d = route ? Math.min(...route.map((l) => lineD(l, mx, my))) : 1e9, dOut = edgeD(OUTER, mx, my), dIn = edgeD(INNER, mx, my);
    const dAcc = Math.min(1e9, ...accents.map((s) => Math.hypot(mx - s[0], my - s[1]))), dStop = Math.min(1e9, ...stops.map((s) => Math.hypot(mx - s[0], my - s[1])));
    const hx = hole ? Math.abs(mx - hole.x) : 0, dHole = hole ? Math.max(hx / H3, hx * 0.57735 + Math.abs(my - hole.y)) * H3 - hole.r * H3 : 1e9; // to the artwork's hexagon
    const fine = Math.min(d * 1.6, dAcc - 4, dStop - 2, Math.max(0, dHole) * (depth < 4 ? 1 : 1e9) + (depth < 4 ? 0 : 1e9)), coarse = Math.min(dOut - 5, dIn - 2);
    // With a map behind, pieces split along the coast: a piece is all land or all sea.
    const coast = land && depth < 5 && new Set([...t, [mx, my]].map((q) => onLand(q[0], q[1]))).size > 1;
    if (coast || (depth < 5 && fine < size * 1.15) || (depth < 3 && (coarse < size * 1.15 || r < [0.8, 0.55, 0.3][depth]))) {
      const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [a, b, c] = t, ab = m(a, b), bc = m(b, c), ca = m(c, a);
      [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]].forEach((s, i) => piece(s, depth + 1, seed * 4 + i + 1)); return;
    }
    if (!inPoly(face, mx, my) || dHole < -1) return;
    const r2 = h32(seed + 77), q = quietK(mx, my);
    if (dOut < 9) return put(t, mx, my, rgb(LP, 0.72 + 0.3 * r));   // the rim
    if (dIn < 4) return put(t, mx, my, rgb(LP, 0.5 + 0.2 * r));     // the seams between the faces
    const under = 1 - 0.2 * q; // the description lies over the map: what is under it steps back
    if (dAcc < 6.5) return put(t, mx, my, rgb(LA, (0.85 + 0.3 * r) * under));
    if (dStop < 3.6) return put(t, mx, my, rgb(LP, (1.15 + 0.15 * r) * under));
    // Ground legs are a solid band; flights are dotted: every other stretch of the arc is left as it is.
    const dSolid = routes && routes.length ? Math.min(...routes.map((l) => lineD(l, mx, my))) : 1e9;
    if (dSolid < 1.5) return put(t, mx, my, rgb(LP, (0.92 + 0.25 * r) * under));
    for (const l of dotted) if (lineD(l, mx, my) < 1.9 && Math.floor(along(l, mx, my) / 7) % 2 === 0) return put(t, mx, my, rgb(LP, (1.0 + 0.2 * r) * under));
    if (r2 < 0.14 && d > 12 && q < 0.2) return;
    // The map behind: land is where the pieces are, the sea is where most are left out.
    const sea = land && !onLand(mx, my);
    if (sea && r2 < 0.6) return;
    const shore = land && !sea && depth >= 5 && t.some((c) => !onLand(c[0], c[1]));
    const glow = route ? 0.55 * Math.exp(-dSolid / 9) + 0.25 * Math.exp(-d / 6) : Math.exp(-Math.max(0, dHole) / 22) * 0.55;
    put(t, mx, my, rgb(mix(P, LP, glow), ((sea ? 0.11 : shore ? 0.62 : land ? 0.38 : 0.2) + 0.12 * r + 0.72 * glow) * (1 - 0.45 * q)));
  }
  for (let a = -6; a <= 6; a++) for (let b = -10; b <= 10; b++) {
    const Q = (u, v) => [cx + u * h0, cy + (v + u / 2) * S0];
    [[Q(a, b), Q(a + 1, b), Q(a, b + 1)], [Q(a + 1, b), Q(a + 1, b + 1), Q(a, b + 1)]].forEach((t, k) => piece(t, 0, (a + 40) * 997 + (b + 40) * 2 + k + 1));
  }
  return Object.entries(byFill).map(([f, d]) => `<path fill="${f}" d="${d.join('')}"/>`).join('');
}

// One type scale on all three faces.
const F = `font-family="'Space Grotesk',sans-serif"`, U = `font-family="Inter,system-ui,sans-serif"`;
const label = (x, y, t, a = 'start') => `<text x="${x}" y="${y}" text-anchor="${a}" ${U} font-size="10" fill="#9aa0ad" letter-spacing="1.3">${esc(t)}</text>`;
const title = (x, y, t, a = 'start') => `<text x="${x}" y="${y}" text-anchor="${a}" ${F} font-size="21" fill="#e8e9ec">${esc(t)}</text>`;
const small = (x, y, t, fill = '#9aa0ad', a = 'start') => `<text x="${x}" y="${y}" text-anchor="${a}" ${U} font-size="10.5" fill="${fill}">${esc(t)}</text>`;
const wrap = (t, n) => t.split(' ').reduce((l, w) => { const c = l[l.length - 1]; if (c && (c + ' ' + w).length <= n) l[l.length - 1] = c + ' ' + w; else l.push(w); return l; }, []);
const file = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}"><rect width="${BOX}" height="${BOX}" fill="#121418"/>${body}</svg>\n`;
// The text keeps a dark edge, so it reads over a route passing behind it.
const card = (key, href, name, text) => `    <a class="ewin" href="${esc(href)}" aria-label="${esc(name)}"><span class="card"><img src="/assets/embeds/${key}.svg" alt=""><svg viewBox="0 0 ${BOX} ${BOX}" aria-hidden="true" style="paint-order:stroke;stroke:#121418;stroke-width:3px;stroke-linejoin:round">${text}</svg></span></a>`;

// Writes the three faces' SVG files into dir and returns each face's HTML. A missing value (its fetch failed, or
// Strava is not connected) leaves that face with its fractal and a plain link.
export function buildCards({ music: m, travel: t, run: r }, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = {};

  // Music: the artwork cut to a hexagon behind the fractal's seams, the words beside it.
  const hole = { x: cx - 96, y: cy - 150, r: 64 }, s = 9, sh = s * H3;
  const hex = [...Array(6)].map((_, k) => { const a = Math.PI / 3 * k - Math.PI / 2; return [hole.x + hole.r * Math.cos(a), hole.y + hole.r * Math.sin(a)]; });
  const artFile = path.join(dir, 'music.jpg');
  const art = m && fs.existsSync(artFile) ? `<defs><clipPath id="a"><path d="M${hex.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}Z"/></clipPath><pattern id="s" width="${sh * 2}" height="${s}" patternUnits="userSpaceOnUse" patternTransform="translate(${hole.x} ${hole.y})"><path d="M0 0L${sh} ${s / 2}L0 ${s}M${sh} ${s / 2}L${sh * 2} 0M${sh} ${s / 2}L${sh * 2} ${s}M0 0V${s}M${sh} 0V${s}" stroke="#15171a" stroke-width="1.2" fill="none"/></pattern></defs><g clip-path="url(#a)"><image href="data:image/jpeg;base64,${fs.readFileSync(artFile).toString('base64')}" x="${hole.x - hole.r}" y="${hole.y - hole.r}" width="${2 * hole.r}" height="${2 * hole.r}" preserveAspectRatio="xMidYMid slice"/><rect x="${hole.x - hole.r}" y="${hole.y - hole.r}" width="${2 * hole.r}" height="${2 * hole.r}" fill="url(#s)" opacity=".8"/></g>` : '';
  fs.writeFileSync(path.join(dir, 'music.svg'), file(facePieces('music', { hole: art ? hole : null, quiet: [[cx - 30, cy - 196, 190, 100]] }) + art));
  const mx = cx - 18;
  out.music = m
    ? card('music', m.url, `Listen to ${m.title} on Apple Music`, label(mx, cy - 174, 'NEWEST RELEASE') + title(mx, cy - 149, m.title) + small(mx, cy - 131, `${m.artist} · ${m.kind} · ${m.year}`) + small(mx, cy - 111, 'Apple Music →', '#b9bec9'))
    : card('music', 'https://music.apple.com/', 'My music on Apple Music', label(mx, cy - 176, 'MUSIC') + title(mx, cy - 148, 'My music') + small(mx, cy - 106, 'Apple Music →', '#b9bec9'));

  // Travel: the trip's map fills the face, the words centred over it.
  // The route is the tracked one where Polarsteps has it, leg by leg, else straight lines between the steps.
  let stopsT = [], landT = null;
  const routeT = [], flightsT = [];
  if (t && t.steps.length > 1) {
    const lat0 = t.steps.reduce((a, p) => a + p.lat, 0) / t.steps.length, k = Math.cos(lat0 * Math.PI / 180), xy = (p) => [p.lon * k, -p.lat];
    const legs = (t.paths && t.paths.length ? t.paths : [{ points: t.steps }]).map((l) => ({ flight: l.flight, pts: l.flight ? arc(xy(l.points[0]), xy(l.points[l.points.length - 1])) : l.points.map(xy) }));
    const all = fitIn([...t.steps.map(xy), ...legs.flatMap((l) => l.pts)], FACE.travel, 24, 0.8);
    stopsT = all.slice(0, t.steps.length);
    landT = landIn(FACE.travel, (lonLat) => all.to([lonLat[0] * k, -lonLat[1]]));
    let at = t.steps.length;
    for (const l of legs) {
      const pts = all.slice(at, at + l.pts.length); at += l.pts.length;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      // A leg too short to read at this size (a walk around a town) would only thicken the line into a blob.
      if (Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < 9) continue;
      (l.flight ? flightsT : routeT).push(l.flight ? pts : smooth(simplify(pts, 1.5), 2));
    }
  }
  fs.writeFileSync(path.join(dir, 'travel.svg'), file(facePieces('travel', { routes: routeT, dotted: flightsT, land: landT, accents: stopsT.length ? [stopsT[0], stopsT[stopsT.length - 1]] : [], stops: stopsT.slice(1, -1), quiet: [[cx - 190, cy + 17, 120, 114]] })));
  const tx = cx - 130, M = 'middle'; // the face's middle: the description is centred over the map
  if (t) { const lines = wrap(t.title, 10).slice(0, 2); out.travel = card('travel', t.url, `Follow ${t.title} on Polarsteps`, label(tx, cy + 35, 'NEWEST TRIP', M) + lines.map((l, i) => title(tx, cy + 59 + i * 23, l, M)).join('') + small(tx, cy + 77 + (lines.length - 1) * 23, `${t.days} days · ${t.steps.length} steps`, undefined, M) + small(tx, cy + 97 + (lines.length - 1) * 23, 'Polarsteps →', '#b9bec9', M)); }
  else out.travel = card('travel', 'https://www.polarsteps.com/', 'My travels on Polarsteps', label(tx, cy + 35, 'TRAVEL', M) + title(tx, cy + 59, 'My travels', M) + small(tx, cy + 85, 'Polarsteps →', '#b9bec9', M));

  // Running: the route fills the face, the distance and details centred over it.
  let routeR = null;
  if (r && r.route.length > 1) {
    const kr = Math.cos(r.route[0].lat * Math.PI / 180), xy = (p) => [p.lon * kr, -p.lat], fitted = fitIn(r.route.map(xy), FACE.run, 24, 0.75);
    routeR = smooth(simplify(fitted, 2.5), 3);
  }
  fs.writeFileSync(path.join(dir, 'run.svg'), file(facePieces('run', { routes: routeR ? [routeR] : null, accents: routeR ? [routeR[routeR.length - 1]] : [], stops: routeR ? [routeR[0]] : [], quiet: [[cx + 62, cy + 17, 136, 118]] })));
  const rx = cx + 130;
  out.run = r
    ? card('run', r.url, 'See my latest run on Strava', label(rx, cy + 35, 'LATEST RUN', M) + `<text x="${rx}" y="${cy + 71}" text-anchor="middle" ${F} font-size="38" fill="#e8e9ec" letter-spacing="-1">${esc(r.km)}<tspan font-size="16" dx="4" fill="#9aa0ad">km</tspan></text>` + small(rx, cy + 89, `${r.date} · ${r.time}`, undefined, M) + small(rx, cy + 103, `${r.pace} · ${r.up} m up`, undefined, M) + small(rx, cy + 123, 'Strava →', '#b9bec9', M))
    : card('run', 'https://www.strava.com/', 'My running on Strava', label(rx, cy + 35, 'RUNNING', M) + title(rx, cy + 59, 'My runs', M) + small(rx, cy + 85, 'Strava →', '#b9bec9', M));
  return out;
}
