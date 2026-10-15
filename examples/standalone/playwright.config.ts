import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '*.spec.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4180/consumer/',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  webServer: {
    command: 'npm run preview -- --base /consumer/ --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180/consumer/',
  },
});
