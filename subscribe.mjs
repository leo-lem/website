// The newsletter's double opt-in (#23, #39), without a database:
//   POST /api/subscribe  { email }  sends a confirmation email with a signed link
//   GET  /api/confirm?e=&t=&s=      checks the link, adds the contact to the newsletter segment in Resend,
//                                   then redirects to /subscribed/, or to /link-expired/ when the link is no good
// The link carries the address, the time it was made and an HMAC-SHA256 of both. worker.mjs routes /api/* here.
// env: RESEND_API_KEY, RESEND_SEGMENT_ID, NEWSLETTER_SIGNING_KEY, and SIGNUPS, the rate limit binding.
import { render } from './emails/render.mjs';

export const FROM = 'Leopold Lemmermann <hey@leolem.dev>';
export const MAX_AGE = 7 * 24 * 60 * 60; // seconds a confirmation link works
const RESEND = 'https://api.resend.com';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const key = (secret) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const message = (email, t) => enc.encode(`${email}\n${t}`);

export async function sign(secret, email, t) {
  return b64url(await crypto.subtle.sign('HMAC', await key(secret), message(email, t)));
}
// Whether s signs email and t, compared in constant time by WebCrypto.
export async function verify(secret, email, t, s) {
  try { return await crypto.subtle.verify('HMAC', await key(secret), unb64url(s), message(email, t)); } catch { return false; }
}

export const normalize = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
export const valid = (email) => email.length <= 320 && EMAIL.test(email);

const now = () => Math.floor(Date.now() / 1000);
const status = (code) => new Response(null, { status: code });
const redirect = (url, path) => Response.redirect(new URL(path, url).toString(), 303);

async function resend(env, method, path, body) {
  return fetch(RESEND + path, {
    method,
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
}

async function subscribe(request, env, templates) {
  if (request.method !== 'POST') return status(405);
  const url = new URL(request.url);
  // Only the site's own form: a page elsewhere can't sign people up.
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return status(403);
  let body;
  try { body = await request.json(); } catch { return status(400); }
  // The honeypot: a field people never see, so only a bot fills it in. It gets the same answer as everyone.
  if (body?.website) return status(200);
  const email = normalize(body?.email);
  if (!valid(email)) return status(400);
  if (env.SIGNUPS) {
    const { success } = await env.SIGNUPS.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    if (!success) return status(429);
  }
  if (!env.RESEND_API_KEY || !env.NEWSLETTER_SIGNING_KEY) return status(503);

  const t = now();
  const link = `${url.origin}/api/confirm?${new URLSearchParams({ e: email, t: String(t), s: await sign(env.NEWSLETTER_SIGNING_KEY, email, t) })}`;
  const res = await resend(env, 'POST', '/emails', {
    from: FROM,
    to: email,
    subject: 'Confirm your subscription',
    html: render(templates.confirmHtml, { link, site: url.origin }),
    text: render(templates.confirmText, { link }, { html: false }),
  });
  if (!res.ok) { console.error(`sending the confirmation failed: ${res.status} ${await res.text()}`); return status(502); }
  return status(200);
}

// Adds the address to the newsletter segment. Someone who unsubscribed and signs up again is subscribed again.
export async function addContact(env, email) {
  const segment = env.RESEND_SEGMENT_ID;
  const created = await resend(env, 'POST', '/contacts', { email, unsubscribed: false, segments: [{ id: segment }] });
  if (created.ok) return;
  const why = `${created.status} ${await created.text()}`;
  // Anything but "it's there already" is a real failure.
  if (created.status === 401 || created.status === 403 || created.status === 429 || created.status >= 500) throw new Error(`creating the contact failed: ${why}`);
  const id = encodeURIComponent(email);
  const patched = await resend(env, 'PATCH', `/contacts/${id}`, { unsubscribed: false });
  if (!patched.ok) throw new Error(`creating the contact failed (${why}), and so did updating it: ${patched.status} ${await patched.text()}`);
  const added = await resend(env, 'POST', `/contacts/${id}/segments/${segment}`);
  // Already in the segment is fine.
  if (!added.ok && added.status !== 409 && added.status !== 422) throw new Error(`adding the contact to the segment failed: ${added.status} ${await added.text()}`);
}

async function confirm(request, env) {
  if (request.method !== 'GET') return status(405);
  const url = new URL(request.url);
  const email = normalize(url.searchParams.get('e')), t = Number(url.searchParams.get('t')), s = url.searchParams.get('s') || '';
  const age = now() - t;
  const good = valid(email) && Number.isInteger(t) && age >= -60 && age <= MAX_AGE && env.NEWSLETTER_SIGNING_KEY
    && await verify(env.NEWSLETTER_SIGNING_KEY, email, t, s);
  if (!good) return redirect(url, '/link-expired/');
  try { await addContact(env, email); } catch (e) {
    console.error(e.message);
    return new Response('Something went wrong on my side. Try the link again in a few minutes, it works for seven days.', {
      status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return redirect(url, '/subscribed/');
}

// Answers a request under /api/, or null for any other path.
export async function handle(request, env, templates) {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/subscribe') return subscribe(request, env, templates);
  if (pathname === '/api/confirm') return confirm(request, env);
  if (pathname.startsWith('/api/')) return status(404);
  return null;
}
