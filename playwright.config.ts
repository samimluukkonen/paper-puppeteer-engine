import { defineConfig } from '@playwright/test';

const developmentUrl = 'http://127.0.0.1:4173/';
const productionUrl = 'http://127.0.0.1:4174/paper-puppeteer-engine/';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  // Whole authoring workflows with canvas tracing need time on supported desktop hosts.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  use: {
    browserName: 'chromium',
    viewport: { width: 1600, height: 1400 },
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'development', use: { baseURL: developmentUrl } },
    { name: 'production', use: { baseURL: productionUrl } },
  ],
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
      url: `${developmentUrl}rig-editor/`,
    },
    {
      command: 'npm run preview -- --base /paper-puppeteer-engine/ --host 127.0.0.1 --port 4174 --strictPort',
      url: `${productionUrl}rig-editor/`,
    },
  ],
});
