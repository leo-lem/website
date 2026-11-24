// Draws the favicon and writes the icon files into static/: node favicon.mjs
// A hexagon on a corner, split into 24 triangles of the fractal's grid, one centre triangle cut out
// and the piece beside it in the accent. Colours from docs/visual-style.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
const BG = '#15171a', P = [0x5a, 0x6f, 0xa5], A = [0xa0, 0x50, 0x70];
const C = [50, 50], R = 46;
const V = [...Array(6)].map((_, k) => { const a = Math.PI / 3 * k - Math.PI / 2; return [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)]; });
const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
const cen = (t) => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
const col = (c, l) => `rgb(${c.map((v) => Math.round(Math.min(255, v * l))).join(',')})`;
const light = (t) => { const [x, y] = cen(t); return 0.78 + 0.5 * (1 - (x + y) / 200); }; // lighter towards the upper left
const piece = (t, fill) => { const c = cen(t); return `<path d="M${t.map((p) => [c[0] + (p[0] - c[0]) * 0.86, c[1] + (p[1] - c[1]) * 0.86].map((v) => v.toFixed(2)).join(' ')).join('L')}Z" fill="${fill}"/>`; };

// Per big triangle k: 4k the centre piece, 4k+1 and 4k+2 the outer ones, 4k+3 the inverted middle one.
const small = [];
V.forEach((v, k) => { const p = C, q = v, r = V[(k + 1) % 6], pq = mid(p, q), qr = mid(q, r), rp = mid(r, p); small.push([p, pq, rp], [pq, q, qr], [rp, qr, r], [pq, qr, rp]); });
const pieces = small.map((t, k) => k === 0 ? '' : piece(t, col(k === 4 ? A : P, light(t) * (k % 4 === 3 ? 0.9 : 1)))).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${BG}"/><g transform="translate(50 50) scale(0.86) translate(-50 -50)">${pieces}</g></svg>\n`;
// Home screens crop to their own shape, so those get the full square.
const square = svg.replace('rx="22" ', '');

fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg);
const browser = await chromium.launch(), page = await browser.newPage();
async function png(src, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}body{background:transparent}</style><img src="data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}" width="${size}" height="${size}">`);
  return page.screenshot({ omitBackground: true });
}
const files = { 'apple-touch-icon.png': [square, 180], 'icon-192.png': [square, 192], 'icon-512.png': [square, 512] };
for (const [name, [src, size]] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), await png(src, size));
// favicon.ico: 16, 32 and 48 px as PNGs inside one ICO.
const sizes = [16, 32, 48], imgs = [];
for (const s of sizes) imgs.push(await png(svg, s));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(offset, e + 12); offset += imgs[i].length;
});
fs.writeFileSync(path.join(OUT, 'favicon.ico'), Buffer.concat([head, ...imgs]));
await browser.close();
console.log('wrote favicon.svg, favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png');
