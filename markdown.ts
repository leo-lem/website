import YAML from 'yaml';
import type { FigureData } from './articles.ts';

export function figureData(content: string): Partial<FigureData> {
  const m = content.match(/^alt:[ \t]*(.*)$/m);
  if (!m) return YAML.parse(content);
  const alt = /^["']/.test(m[1].trim()) ? YAML.parse(m[1]) : m[1].trim();
  return { ...YAML.parse(content.replace(m[0], '')), alt };
}

export function plainBody(body: string, site: string) {
  return body
    .replace(/```figure\n([\s\S]*?)```/g, (_, y: string) => `*Figure: ${figureData(y).alt}*`)
    .replace(/```number\n([^\n]*)\n([\s\S]*?)```/g, (_, v: string, what: string) => `**${v.trim()}** ${what.trim()}`)
    .replace(/\]\(\/([a-z0-9-]+)\/?((?:#[^)]*)?)\)/g, (_, s: string, h: string) => `](${site}/${s}/${h})`)
    .replace(/\]\((\/[^)\s]*)\)/g, (_, p: string) => `](${site}${p})`)
    .trim();
}

export const WORDS_PER_MINUTE = 220;
export function readMinutes(body: string) {
  const text = plainBody(body, '').replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, ' ');
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
