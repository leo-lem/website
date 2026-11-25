import { defineConfig } from '@playwright/test';

const port = process.env.TEST_PORT || '4322';
const remote = process.env.BASE_URL;
export default defineConfig({
  testDir: 'test',
  use: {
    baseURL: remote || `http://localhost:${port}`,
    launchOptions: { headless: true, args: process.env.CI ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    viewport: { width: 1024, height: 700 },
  },
  webServer: remote ? undefined : { command: 'node serve.ts', env: { PORT: port }, url: `http://localhost:${port}/`, reuseExistingServer: false },
});
