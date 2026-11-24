import { defineConfig } from '@playwright/test';

// Tests run against the built site in dist/, served locally. Build first: npm run build.
// TEST_PORT picks the port, so several checkouts can test at once.
// BASE_URL points them at a deployed site instead, a preview for example, and serves nothing locally.
const port = process.env.TEST_PORT || '4322';
const remote = process.env.BASE_URL;
export default defineConfig({
  testDir: 'test',
  use: {
    baseURL: remote || `http://localhost:${port}`,
    // The few tests that need a browser render the fractal in software, off the GPU: on a laptop the GPU version
    // can freeze the machine, and CI has no GPU anyway.
    // On CI WebGL is off entirely: software rendering hung the browser on GitHub's small runners. The pages then
    // show their plain layout, which visitors without WebGL get too.
    launchOptions: { headless: true, args: process.env.CI ? ['--disable-webgl', '--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    viewport: { width: 1024, height: 700 },
  },
  webServer: remote ? undefined : { command: 'node serve.mjs', env: { PORT: port }, url: `http://localhost:${port}/`, reuseExistingServer: false },
});
