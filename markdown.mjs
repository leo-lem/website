// An article's body as Markdown that reads well without the site, for /<slug>.md and the channels that take
// the full text (dev.to): figures become their alt text, numbers a line, every link to the site absolute.
import YAML from 'yaml';

export function plainBody(body, site) {
  return body
    .replace(/```figure\n([\s\S]*?)```/g, (_, y) => `*Figure: ${YAML.parse(y).alt}*`)
    .replace(/```number\n([^\n]*)\n([\s\S]*?)```/g, (_, v, what) => `**${v.trim()}** ${what.trim()}`)
    // Links to other articles, with the trailing slash their URLs have.
    .replace(/\]\(\/([a-z0-9-]+)\/?((?:#[^)]*)?)\)/g, (_, s, h) => `](${site}/${s}/${h})`)
    // Anything else on the site: the home page, assets.
    .replace(/\]\((\/[^)\s]*)\)/g, (_, p) => `](${site}${p})`)
    .trim();
}
