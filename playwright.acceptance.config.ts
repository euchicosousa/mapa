import { defineConfig, devices } from '@playwright/test';
process.env.MAPA_EVIDENCE_TICKET = '28';
export default defineConfig({
  testDir: './tests', testMatch: ['acceptance/*.spec.ts', 'deployment/published.spec.ts'],
  workers: 1, fullyParallel: false, timeout: 180_000, expect: { timeout: 20_000 },
  globalSetup: './tests/auth/global-setup.mjs', reporter: [['list']],
  use: { baseURL: 'https://mapa.cnvt.com.br', trace: 'off', video: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
});
