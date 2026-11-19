import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// Runs against the production build (`npm run e2e` builds first), because the
// worker is bundled differently there than under the dev server.
export default defineConfig({
  testDir: 'e2e',
  // One at a time: each page renders WebGL in software at full frame rate, and
  // several of them at once starve each other into timeouts. The whole suite
  // takes about a minute serially with a GPU, and six without.
  workers: 1,
  // Without a GPU, which is how CI runs, the view from the ground is drawn
  // about once a second, and every step that waits on the page waits a
  // frame. Nothing there is slow that would be fast if it worked: the time
  // allowed is for the frames.
  timeout: process.env.CI ? 120_000 : 30_000,
  expect: { timeout: process.env.CI ? 30_000 : 5_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Set PW_CHANNEL=chrome to use an installed Chrome instead of downloading one.
        channel: process.env.PW_CHANNEL,
        // Headless machines have no GPU, so WebGL renders in software, which
        // keeps every core busy. Set PW_GPU=1 on a machine that has one.
        launchOptions: {
          args: process.env.PW_GPU
            ? ['--enable-gpu', '--ignore-gpu-blocklist']
            : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
