import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/performance', workers: 1, fullyParallel: false,
  timeout: 180_000, expect: { timeout: 20_000 },
  globalSetup: './tests/auth/global-setup.mjs',
  outputDir: 'test-results-performance', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4175', trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-emulated', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4175 --strictPort', url: 'http://127.0.0.1:4175', reuseExistingServer: false },
});
