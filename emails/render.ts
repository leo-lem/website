const escape = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type Values = Record<string, unknown>;

export function render(template: string, values: Values, { html = true }: { html?: boolean } = {}): string {
  const out = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name: string, inner: string) => {
    const list = values[name];
    if (!Array.isArray(list)) throw new Error(`the template's list ${name} has no values`);
    return list.map((item: Values) => render(inner, { ...values, ...item }, { html })).join('');
  });
  return out.replace(/(?<!\{)\{\{(\w+)\}\}(?!\})/g, (_, name: string) => {
    if (!(name in values)) throw new Error(`the template's {{${name}}} has no value`);
    return html ? escape(values[name]).replace(/\n/g, '<br>\n') : String(values[name]);
  });
}
