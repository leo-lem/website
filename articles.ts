import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { z } from 'zod';
import { layout } from './scenes.ts';
import type { Scene } from './scenes.ts';

const SITE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = fs.existsSync(path.join(SITE, '../articles')) ? path.join(SITE, '..') : path.join(SITE, 'example');

export const Form = z.object({
  shape: z.enum(['hexagon', 'triangle', 'rhombus', 'trapezoid']),
  at: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  size: z.number().positive(),
  focus: z.boolean().optional(),
  absent: z.boolean().optional(),
}).strict();

export const SceneForm = z.object({
  shape: z.enum(['hexagon', 'triangle', 'rhombus', 'trapezoid']),
  at: z.tuple([z.number().int().min(-8).max(8), z.number().int().min(-16).max(16)]),
  size: z.number().int().min(1).max(12),
  focus: z.boolean().optional(),
  absent: z.boolean().optional(),
  to: z.number().int().optional(),
}).strict();

export const Article = z.object({
  title: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  summary: z.string().min(1),
  scene: z.array(SceneForm).min(2).max(6),
  author: z.object({ name: z.string().min(1), url: z.string().url() }).strict().optional(),
  channels: z.object({
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

export type Frontmatter = z.infer<typeof Article>;
export type Article = Omit<Frontmatter, 'scene'> & { slug: string; scene: Scene; body: string };
export type FigureData = z.infer<typeof Figure>;

export const today = () => process.env.TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());

export function readArticles(dir = path.join(ROOT, 'articles')): Article[] {
  const errors: string[] = [];
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((file) => {
    const slug = file.slice(0, -3), text = fs.readFileSync(path.join(dir, file), 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) { errors.push(`${file}: no frontmatter`); return null; }
    let data: unknown;
    try { data = YAML.parse(m[1]); } catch (e) { errors.push(`${file}: ${(e as Error).message}`); return null; }
    const r = Article.safeParse(data);
    if (!r.success) { r.error.issues.forEach((i) => errors.push(`${file}: ${i.path.join('.') || '(frontmatter)'}: ${i.message}`)); return null; }
    const l = layout(r.data.scene), scene: Scene = { forms: l.forms, trails: l.trails };
    l.problems.forEach((p) => errors.push(`${file}: scene: ${p}`));
    return { slug, ...r.data, scene, summary: r.data.summary.trim().replace(/\s+/g, ' '), body: m[2] };
  }).filter((a) => a !== null);
  if (errors.length) throw new Error(errors.join('\n'));
  return all;
}
