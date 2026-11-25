# leolem.dev

The code behind [leolem.dev](https://leolem.dev), the personal site of Leopold Lemmermann.

This repository is a read-only mirror. The site is built in a private repository, together with its articles, and the code is copied here on each new version. Issues and pull requests are turned off. It is MIT licensed, so take whatever is useful.

## What it is

A static site with no framework and no bundler. `build.ts` is a plain Node script on three small libraries (markdown-it, yaml, zod). It reads the articles, checks their frontmatter, and writes every page into `dist/`, along with the sitemap, `llms.txt`, a Markdown version of each article and the redirects.

- **The fractal:** one canvas with a WebGL 2 shader (`src/fractal.glsl`) and a small script per page (`src/home.ts`, `src/article.ts`, their types stripped when building). It is decoration over real HTML: every page carries all its text, and without WebGL or script the pages show a plain layout.
- **Scenes:** each article's artwork is a short list of forms in its frontmatter, placed on the fractal's grid by `scenes.ts` and drawn as SVG, and as JPG for link previews.
- **Off the clock:** the newest music release, trip and run, fetched while building (`embeds.ts`, `embeds.yml`) and drawn as cards. When a service can't be reached they fall back to plain links, and without Strava secrets in `.env` the run card stays a stand-in.
- **The discussion:** an article that went out on LinkedIn ends with a link to the post. The posts are recorded in the releases of the private repository, which `posts.ts` reads with `GITHUB_TOKEN` and `GITHUB_REPOSITORY`. Without them it reads `example/releases.json`.
- **Hosting:** static files on Cloudflare Workers (`wrangler.jsonc`), with `serve.ts` mimicking it locally.

## Running it locally

Needs Node 24.

```sh
npm install
npm run dev
```

That builds the site and serves it on http://localhost:4321. The real articles aren't in this repository, so the build uses the stand-ins in `example/`: `example/articles/` holds the articles and their redirects, `example/docs/positioning.md` the bio and profiles, `example/releases.json` a LinkedIn post.

`TODAY=YYYY-MM-DD` builds the site as of another day, and `PREVIEW=1` includes articles dated in the future.

The tests in `test/` (Playwright) run against whatever was built: `npm run build && npm test`.
