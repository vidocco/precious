import { defineConfig, devices } from '@playwright/test';

const PORT = 3400;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  // Each test walks a whole journey through the app.
  timeout: 120_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A fake camera, so the barcode scanner can start.
    permissions: ['camera'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Stands in for remote APIs and websites, so tests never touch the internet.
      command: 'node e2e/mock-api.ts',
      url: 'http://127.0.0.1:3401/health',
      reuseExistingServer: false,
      env: { MOCK_PORT: '3401' },
    },
    {
      command: 'node apps/server/scripts/e2e-server.ts',
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_PORT: String(PORT) },
    },
  ],
});
