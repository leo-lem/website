import { render } from './emails/render.ts';
import type { RateLimit } from '@cloudflare/workers-types';

export type Env = { RESEND_API_KEY?: string; RESEND_SEGMENT_ID?: string; NEWSLETTER_SIGNING_KEY?: string; SIGNUPS?: RateLimit };
export type ApiRequest = Pick<Request, 'method' | 'url' | 'json'> & { headers: Pick<Headers, 'get'> };
export type Templates = { confirmHtml: string; confirmText: string };

export const FROM = 'Leopold Lemmermann <hey@leolem.dev>';
export const MAX_AGE = 7 * 24 * 60 * 60;
const RESEND = 'https://api.resend.com';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const key = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const message = (email: string, t: number) => enc.encode(`${email}\n${t}`);

export async function sign(secret: string, email: string, t: number) {
  return b64url(await crypto.subtle.sign('HMAC', await key(secret), message(email, t)));
}
export async function verify(secret: string, email: string, t: number, s: string) {
  try { return await crypto.subtle.verify('HMAC', await key(secret), unb64url(s), message(email, t)); } catch { return false; }
}

export const normalize = (email: unknown) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
export const valid = (email: string) => email.length <= 320 && EMAIL.test(email);

const now = () => Math.floor(Date.now() / 1000);
const status = (code: number) => new Response(null, { status: code });
const redirect = (url: URL, path: string) => Response.redirect(new URL(path, url).toString(), 303);

async function resend(env: Env, method: string, path: string, body?: object) {
  return fetch(RESEND + path, {
    method,
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
}

async function subscribe(request: ApiRequest, env: Env, templates: Templates) {
  if (request.method !== 'POST') return status(405);
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return status(403);
  let body: { website?: unknown; email?: unknown } | null;
  try { body = await request.json(); } catch { return status(400); }
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

export async function addContact(env: Env, email: string) {
  const segment = env.RESEND_SEGMENT_ID;
  const created = await resend(env, 'POST', '/contacts', { email, unsubscribed: false, segments: [{ id: segment }] });
  if (created.ok) return;
  const why = `${created.status} ${await created.text()}`;
  if (created.status === 401 || created.status === 403 || created.status === 429 || created.status >= 500) throw new Error(`creating the contact failed: ${why}`);
  const id = encodeURIComponent(email);
  const patched = await resend(env, 'PATCH', `/contacts/${id}`, { unsubscribed: false });
  if (!patched.ok) throw new Error(`creating the contact failed (${why}), and so did updating it: ${patched.status} ${await patched.text()}`);
  const added = await resend(env, 'POST', `/contacts/${id}/segments/${segment}`);
  if (!added.ok && added.status !== 409 && added.status !== 422) throw new Error(`adding the contact to the segment failed: ${added.status} ${await added.text()}`);
}

async function confirm(request: ApiRequest, env: Env) {
  if (request.method !== 'GET') return status(405);
  const url = new URL(request.url);
  const email = normalize(url.searchParams.get('e')), t = Number(url.searchParams.get('t')), s = url.searchParams.get('s') || '';
  const age = now() - t;
  const good = valid(email) && Number.isInteger(t) && age >= -60 && age <= MAX_AGE && env.NEWSLETTER_SIGNING_KEY
    && await verify(env.NEWSLETTER_SIGNING_KEY, email, t, s);
  if (!good) return redirect(url, '/link-expired/');
  try { await addContact(env, email); } catch (e) {
    console.error((e as Error).message);
    return new Response('Something went wrong on my side. Try the link again in a few minutes, it works for seven days.', {
      status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return redirect(url, '/subscribed/');
}

export async function handle(request: ApiRequest, env: Env, templates: Templates) {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/subscribe') return subscribe(request, env, templates);
  if (pathname === '/api/confirm') return confirm(request, env);
  if (pathname.startsWith('/api/')) return status(404);
  return null;
}
