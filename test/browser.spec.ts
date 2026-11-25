import { test, expect } from '@playwright/test';
import { due } from './content.ts';

test.beforeEach(async ({ context }) => {
  await context.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
});

test('the home page keeps its section in the address and opens there', async ({ page }) => {
  test.skip(!!process.env.CI, 'needs WebGL, which is off on CI');
  await page.goto('/');
  await page.locator('#stage').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page).toHaveURL(/#leo$/);
  await page.keyboard.press('ArrowDown');
  await expect(page).toHaveURL(/#writing$/);
  await page.keyboard.press('End');
  await expect(page).toHaveURL(/#talk$/);
  await page.keyboard.press('Home');
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/#off-the-clock');
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/#off-the-clock$/);
});

test('the home page leaves a sideways swipe to the browser', async ({ page }) => {
  test.skip(!!process.env.CI, 'needs WebGL, which is off on CI');
  await page.goto('/');
  const taken = (deltaX: number, deltaY: number) => page.evaluate(([x, y]) => {
    const e = new WheelEvent('wheel', { deltaX: x, deltaY: y, bubbles: true, cancelable: true });
    document.getElementById('stage')!.dispatchEvent(e);
    return e.defaultPrevented;
  }, [deltaX, deltaY]);
  expect(await taken(0, 40)).toBe(true);
  expect(await taken(6, 40)).toBe(true);
  expect(await taken(60, 4)).toBe(false);
  expect(await taken(-60, 0)).toBe(false);
});

test('Schedule a call stays on the page, home and article alike', async ({ page }) => {
  for (const p of ['/', `/${(await due(page.request))[0].slug}/`]) {
    await page.goto(p);
    await page.locator('#openCal').click();
    await expect(page.locator('#calbox')).toHaveClass(/open/);
    expect(new URL(page.url()).pathname).toBe(p);
    await page.keyboard.press('Escape');
  }
});

test('the pages run without script errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const p of ['/', '/#off-the-clock', `/${(await due(page.request))[0].slug}/`]) {
    await page.goto(p);
    await page.waitForTimeout(400);
  }
  expect(errors).toEqual([]);
});

test('without WebGL the home page is an ordinary page with everything on it', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) { return /webgl/.test(type) ? null : get.call(this, type, ...rest); } as typeof get;
  });
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/\bgl\b/);
  await expect(page.locator('.s2 .list a').first()).toBeVisible();
  await expect(page.locator('.ewin').first()).toBeVisible();
  await expect(page.locator('#nl-email')).toBeVisible();
  await expect(page.locator('.s1 .profiles a').first()).toBeVisible();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('the newsletter form sends the address and says what happened', async ({ page }) => {
  const sent: unknown[] = [];
  let reply = 200;
  await page.route('**/api/subscribe', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: reply });
  });
  for (const p of [`/${(await due(page.request))[0].slug}/`, '/link-expired/']) {
    sent.length = 0;
    reply = 200;
    await page.goto(p);
    await page.locator('#nl-email').fill('ada@example.com');
    await page.locator('#nl button').click();
    await expect(page.locator('#nl-msg')).toHaveText('Check your inbox to confirm.');
    expect(sent).toEqual([{ email: 'ada@example.com', website: '' }]);
    await expect(page.locator('#nl-email')).toHaveValue('');
    reply = 400;
    await page.locator('#nl-email').fill('ada@example.com');
    await page.locator('#nl button').click();
    await expect(page.locator('#nl-msg')).toHaveText('That address doesn’t look right.');
    reply = 502;
    await page.locator('#nl button').click();
    await expect(page.locator('#nl-msg')).toHaveText('That didn’t go through. Try again in a minute.');
  }
});
