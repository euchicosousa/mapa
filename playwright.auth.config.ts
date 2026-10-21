import { defineConfig, devices } from '@playwright/test';

// The target (.env.local, MAPA_PROJECT_REF, secret key) is checked in global setup
// before any resource is created. The config itself imports no Supabase code.
export default defineConfig({
  testDir: './tests/auth',
  fullyParallel: false,
  workers: 1,
  // These assertions cross the real Auth/database network, not a local fixture.
  expect: { timeout: 15_000 },
  globalSetup: './tests/auth/global-setup.mjs',
  reporter: [['list'], ['html', { outputFolder: 'playwright-auth-report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
