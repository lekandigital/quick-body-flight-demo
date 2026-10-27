import { defineConfig } from '@playwright/test';

// No camera or private fixture is needed for the loading/glass regressions.
export default defineConfig({
  testDir: 'tests',
  testMatch: 'loading-glass.spec.ts',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
});
