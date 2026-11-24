// Fills the email templates in this folder (#39). Used by the Worker for the confirmation email and by the
// weekly run for the release email.
//   {{name}}               a value, HTML-escaped when the template is HTML
//   {{#name}}...{{/name}}  repeated for each item of a list, its fields as {{field}}; left out when the list is empty
//   {{{RESEND_UNSUBSCRIBE_URL}}} and other triple braces are left alone, for Resend to fill in.
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function render(template, values, { html = true } = {}) {
  const out = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name, inner) => {
    const list = values[name];
    if (!Array.isArray(list)) throw new Error(`the template's list ${name} has no values`);
    return list.map((item) => render(inner, { ...values, ...item }, { html })).join('');
  });
  return out.replace(/(?<!\{)\{\{(\w+)\}\}(?!\})/g, (_, name) => {
    if (!(name in values)) throw new Error(`the template's {{${name}}} has no value`);
    // Several lines in a value become line breaks in HTML.
    return html ? escape(values[name]).replace(/\n/g, '<br>\n') : String(values[name]);
  });
}
