import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { due } from './content.ts';

test.beforeEach(async ({ context }) => {
  await context.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
});

async function gaps(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  return r.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

const withoutWebGL = (page: Page) => page.addInitScript(() => {
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) { return /webgl/.test(type) ? null : get.call(this, type, ...rest); } as typeof get;
});

test('the home page and the newest article have no accessibility gaps', async ({ page }) => {
  for (const p of ['/', `/${(await due(page.request))[0].slug}/`]) {
    await page.goto(p);
    await page.waitForTimeout(300);
    expect(await gaps(page), p).toEqual([]);
  }
});

test('the home page has no accessibility gaps without WebGL either', async ({ page }) => {
  await withoutWebGL(page);
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/\bgl\b/);
  expect(await gaps(page)).toEqual([]);
});
