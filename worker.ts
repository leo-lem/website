import type { Fetcher, Request as WorkerRequest } from '@cloudflare/workers-types';
import { handle } from './subscribe.ts';
import type { Env } from './subscribe.ts';
import confirmHtml from './emails/confirm.html';
import confirmText from './emails/confirm.txt';

const templates = { confirmHtml, confirmText };

export default {
  async fetch(request: WorkerRequest, env: Env & { ASSETS: Fetcher }) {
    return (await handle(request, env, templates)) || env.ASSETS.fetch(request);
  },
};
