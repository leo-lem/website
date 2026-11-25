import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS: [string, number, number][] = [
  ['static/social.jpg', 1200, 630],
  ['static/banner.jpg', 1584, 396],
];
if (!fs.existsSync(path.join(SITE, 'dist/index.html'))) { console.error('build first: npm run build'); process.exit(1); }

const PORT = 4398, server = spawn(process.execPath, ['serve.ts'], { cwd: SITE, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const [file, width, height] of SHOTS) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`http://localhost:${PORT}/`);
    await page.addStyleTag({ content: 'body *{visibility:hidden!important}#gl{visibility:visible!important}' });
    await page.evaluate(() => (window as unknown as { __hold(p: number, t: number): void }).__hold(0, 40));
    await page.waitForTimeout(2500);
    fs.mkdirSync(path.dirname(path.join(SITE, file)), { recursive: true });
    await page.screenshot({ path: path.join(SITE, file), type: 'jpeg', quality: 85 });
    await page.close();
    console.log(`wrote ${file} (${Math.round(fs.statSync(path.join(SITE, file)).size / 1024)} KB)`);
  }
} finally {
  await browser.close();
  server.kill();
}
