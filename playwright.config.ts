import { defineConfig } from '@playwright/test';

// Run against localhost by default; set BASE_URL to test production.
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
const isLocal = baseURL.startsWith('http://localhost');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: isLocal ? 0 : 1,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: isLocal
    ? {
        command: 'powershell -ExecutionPolicy Bypass -File scripts/dev.ps1',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
