// The site's Worker (#39). Cloudflare runs it only for /api/*, the newsletter's signup (subscribe.mjs).
// Every other path is a static file from dist/, served without it.
import { handle } from './subscribe.mjs';
import confirmHtml from './emails/confirm.html';
import confirmText from './emails/confirm.txt';

const templates = { confirmHtml, confirmText };

export default {
  async fetch(request, env) {
    return (await handle(request, env, templates)) || env.ASSETS.fetch(request);
  },
};
