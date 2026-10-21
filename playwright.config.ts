import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 } },
    },
    {
      name: 'mobile-360',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 360, height: 800 } },
    },
  ],
  // The public smoke always runs on its own unconfigured build: empty process env
  // overrides .env.local, so a configured developer machine does not change it.
  webServer: {
    command:
      'VITE_SUPABASE_URL= VITE_SUPABASE_PUBLISHABLE_KEY= npx vite build --outDir dist-smoke --emptyOutDir && npx vite preview --outDir dist-smoke --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
