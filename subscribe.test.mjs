// The newsletter's signup and confirmation (subscribe.mjs) against a stubbed Resend: node --test
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handle, sign, MAX_AGE } from './subscribe.mjs';
import { render } from './emails/render.mjs';

const read = (f) => fs.readFileSync(new URL(`./emails/${f}`, import.meta.url), 'utf8');
const templates = { confirmHtml: read('confirm.html'), confirmText: read('confirm.txt') };
const SITE = 'https://leolem.dev';
const KEY = 'test-signing-key';

let calls, replies, limited;
const env = () => ({
  RESEND_API_KEY: 're_test', RESEND_SEGMENT_ID: 'seg_1', NEWSLETTER_SIGNING_KEY: KEY,
  SIGNUPS: { limit: async () => ({ success: !limited }) },
});
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = []; replies = []; limited = false;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
    const [code, body] = replies.shift() || [200, { id: 'x' }];
    return new Response(JSON.stringify(body), { status: code });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const post = (body, headers = {}) => handle(new Request(`${SITE}/api/subscribe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SITE, ...headers }, body: JSON.stringify(body),
}), env(), templates);
const confirm = async (email, t) => handle(new Request(`${SITE}/api/confirm?${new URLSearchParams({ e: email, t: String(t), s: await sign(KEY, email, t) })}`), env(), templates);
const now = () => Math.floor(Date.now() / 1000);

test('a signup sends one confirmation email with a signed link that confirms', async () => {
  const res = await post({ email: '  Ada@Example.com ' });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  const [mail] = calls;
  assert.equal(mail.url, 'https://api.resend.com/emails');
  assert.equal(mail.body.from, 'Leopold Lemmermann <hey@leolem.dev>');
  assert.equal(mail.body.to, 'ada@example.com');
  const link = mail.body.text.match(/https:\/\/leolem\.dev\/api\/confirm\?\S+/)[0];
  assert.ok(mail.body.html.includes(link.replace(/&/g, '&amp;')), 'the same link in the HTML');

  calls = [];
  const done = await handle(new Request(link), env(), templates);
  assert.equal(done.status, 303);
  assert.equal(done.headers.get('Location'), `${SITE}/subscribed/`);
  assert.deepEqual(calls, [{ url: 'https://api.resend.com/contacts', method: 'POST', body: { email: 'ada@example.com', unsubscribed: false, segments: [{ id: 'seg_1' }] } }]);
});

test('the link is built on the origin the signup came from, so a preview stays on the preview', async () => {
  const preview = 'https://pr-9-leolem.leopold-l.workers.dev';
  await handle(new Request(`${preview}/api/subscribe`, { method: 'POST', headers: { Origin: preview }, body: JSON.stringify({ email: 'a@b.co' }) }), env(), templates);
  assert.match(calls[0].body.text, new RegExp(`${preview.replace(/\./g, '\\.')}/api/confirm\\?`));
});

test('a wrong address is a 400 and sends nothing', async () => {
  for (const email of ['', 'nope', 'a@b', 'a b@c.de', 42, `${'a'.repeat(320)}@b.co`]) {
    assert.equal((await post({ email })).status, 400, String(email));
  }
  assert.equal((await handle(new Request(`${SITE}/api/subscribe`, { method: 'POST', body: '{nope' }), env(), templates)).status, 400);
  assert.equal(calls.length, 0);
});

test('the honeypot answers like a signup and sends nothing', async () => {
  assert.equal((await post({ email: 'a@b.co', website: 'http://spam' })).status, 200);
  assert.equal(calls.length, 0);
});

test('another site, another method, too many signups: refused, nothing sent', async () => {
  assert.equal((await post({ email: 'a@b.co' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await handle(new Request(`${SITE}/api/subscribe`), env(), templates)).status, 405);
  limited = true;
  assert.equal((await post({ email: 'a@b.co' })).status, 429);
  assert.equal(calls.length, 0);
});

test('Resend failing to send is a 502', async () => {
  replies = [[500, { message: 'down' }]];
  assert.equal((await post({ email: 'a@b.co' })).status, 502);
});

test('a forged, changed or expired link goes to /link-expired/ and adds nobody', async () => {
  const t = now();
  const good = new URL((await confirm('a@b.co', t)).headers.get('Location'));
  assert.equal(good.pathname, '/subscribed/');
  calls = [];
  const s = await sign(KEY, 'a@b.co', t);
  const tries = [
    `e=other%40b.co&t=${t}&s=${s}`, // another address
    `e=a%40b.co&t=${t + 1}&s=${s}`, // another time
    `e=a%40b.co&t=${t}&s=${await sign('other-key', 'a@b.co', t)}`, // another key
    `e=a%40b.co&t=${t}&s=garbage!`,
    `e=a%40b.co&t=${t}`,
    '',
  ];
  for (const q of tries) {
    const res = await handle(new Request(`${SITE}/api/confirm?${q}`), env(), templates);
    assert.equal(res.headers.get('Location'), `${SITE}/link-expired/`, q);
  }
  assert.equal((await confirm('a@b.co', now() - MAX_AGE - 1)).headers.get('Location'), `${SITE}/link-expired/`);
  assert.equal((await confirm('a@b.co', now() + 3600)).headers.get('Location'), `${SITE}/link-expired/`);
  assert.equal(calls.length, 0);
});

test('a link up to seven days old still works', async () => {
  assert.equal((await confirm('a@b.co', now() - MAX_AGE + 60)).headers.get('Location'), `${SITE}/subscribed/`);
});

test('someone already a contact, perhaps unsubscribed, is subscribed again and put in the segment', async () => {
  replies = [[422, { message: 'Contact already exists' }], [200, {}], [200, {}]];
  const res = await confirm('a@b.co', now());
  assert.equal(res.headers.get('Location'), `${SITE}/subscribed/`);
  assert.deepEqual(calls.slice(1).map((c) => [c.method, c.url, c.body]), [
    ['PATCH', 'https://api.resend.com/contacts/a%40b.co', { unsubscribed: false }],
    ['POST', 'https://api.resend.com/contacts/a%40b.co/segments/seg_1', undefined],
  ]);
});

test('Resend failing on confirm says so, and the link keeps working', async () => {
  replies = [[500, { message: 'down' }]];
  const res = await confirm('a@b.co', now());
  assert.equal(res.status, 502);
  assert.match(await res.text(), /Try the link again/);
});

test('other paths under /api/ are a 404, anything else is left to the static files', async () => {
  assert.equal((await handle(new Request(`${SITE}/api/nope`), env(), templates)).status, 404);
  assert.equal(await handle(new Request(`${SITE}/subscribed/`), env(), templates), null);
});

test('the templates: values escaped in HTML, lists repeated, Resend placeholders kept', () => {
  assert.equal(render('<a href="{{u}}">{{t}}</a>', { u: 'x?a=1&b=2', t: '<b>' }), '<a href="x?a=1&amp;b=2">&lt;b&gt;</a>');
  assert.equal(render('{{t}}', { t: '<b>' }, { html: false }), '<b>');
  assert.equal(render('{{#l}}[{{v}}]{{/l}}', { l: [{ v: 1 }, { v: 2 }] }), '[1][2]');
  assert.equal(render('{{{RESEND_UNSUBSCRIBE_URL}}}', {}), '{{{RESEND_UNSUBSCRIBE_URL}}}');
  assert.equal(render('{{n}}', { n: 'one\ntwo' }), 'one<br>\ntwo');
  assert.throws(() => render('{{missing}}', {}), /missing/);
});
