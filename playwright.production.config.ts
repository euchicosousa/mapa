import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/deployment', workers: 1, fullyParallel: false,
  timeout: 90_000, expect: { timeout: 20_000 },
  globalSetup: './tests/auth/global-setup.mjs',
  reporter: [['list']],
  use: { baseURL: 'https://mapa.cnvt.com.br', trace: 'off', video: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
});
