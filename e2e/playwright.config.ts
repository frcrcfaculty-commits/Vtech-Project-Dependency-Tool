// Run: npx playwright test -c e2e/playwright.config.ts  (env from .env.local, see e2e/README.md)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.e2e\.ts$/,
  timeout: 60_000,
  workers: 1,               // one shared Supabase project: run serially
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
  outputDir: '.out',
  use: { baseURL: process.env.E2E_BASE_URL },
});
