// Reads ../articles/*.md and checks each against docs/article-format.md.
// Without ../articles, as in the public mirror, it reads the stand-ins in example/.
// Shared by the site build, the weekly run and the profile README (scripts/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { z } from 'zod';
import { layout } from './scenes.mjs';

// The content: articles/ and docs/positioning.md, next to site/ here and in example/ in the mirror.
const SITE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = fs.existsSync(path.join(SITE, '../articles')) ? path.join(SITE, '..') : path.join(SITE, 'example');

export const Form = z.object({
  shape: z.enum(['hexagon', 'triangle', 'rhombus', 'trapezoid']),
  at: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  size: z.number().positive(),
  focus: z.boolean().optional(),
  absent: z.boolean().optional(),
}).strict();

// A scene's form sits on the grid (site/scenes.mjs): `at` in whole steps from the hexagon's middle, `size` in
// whole units. The hexagon reaches 8 steps to each side and 16 units up and down.
export const SceneForm = z.object({
  shape: z.enum(['hexagon', 'triangle', 'rhombus', 'trapezoid']),
  at: z.tuple([z.number().int().min(-8).max(8), z.number().int().min(-16).max(16)]),
  size: z.number().int().min(1).max(12),
  focus: z.boolean().optional(),
  absent: z.boolean().optional(),
  to: z.number().int().optional(), // a trail from this form to that one, counted from 1
}).strict();

export const Article = z.object({
  title: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  summary: z.string().min(1),
  scene: z.array(SceneForm).min(2).max(6),
  author: z.object({ name: z.string().min(1), url: z.string().url() }).strict().optional(),
  channels: z.object({
    // An article that already went out lists its channels with what was recorded, which may be nothing
    // (docs/article-format.md, Existing articles). A channel still owed needs its text: the weekly run checks that.
    linkedin: z.object({ text: z.string().min(1).optional() }).strict().optional(),
    newsletter: z.object({ note: z.string().min(1).optional() }).strict().optional(),
    devto: z.object({ tags: z.array(z.string()).max(4) }).strict().optional(),
    medium: z.object({}).strict().optional(),
  }).strict(),
}).strict();

export const Figure = z.object({
  alt: z.string().min(1),
  forms: z.array(Form.extend({ label: z.string().optional() }).strict()).min(1),
}).strict();

// Today in Berlin as YYYY-MM-DD. TODAY=YYYY-MM-DD overrides it.
export const today = () => process.env.TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());

// Every article, or throws with every problem found. dir defaults to the repo's articles/.
export function readArticles(dir = path.join(ROOT, 'articles')) {
  const errors = [];
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((file) => {
    const slug = file.slice(0, -3), text = fs.readFileSync(path.join(dir, file), 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) { errors.push(`${file}: no frontmatter`); return null; }
    let data;
    try { data = YAML.parse(m[1]); } catch (e) { errors.push(`${file}: ${e.message}`); return null; }
    const r = Article.safeParse(data);
    if (!r.success) { r.error.issues.forEach((i) => errors.push(`${file}: ${i.path.join('.') || '(frontmatter)'}: ${i.message}`)); return null; }
    // A scene's forms are placed on the grid here, and one that doesn't fit is an error like any other.
    const l = layout(r.data.scene), scene = { forms: l.forms, trails: l.trails };
    l.problems.forEach((p) => errors.push(`${file}: scene: ${p}`));
    // A summary is one line wherever it shows, however the YAML wraps it.
    return { slug, ...r.data, scene, summary: r.data.summary.trim().replace(/\s+/g, ' '), body: m[2] };
  }).filter(Boolean);
  if (errors.length) throw new Error(errors.join('\n'));
  return all;
}
