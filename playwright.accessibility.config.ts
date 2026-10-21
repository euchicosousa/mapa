import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  outputDir:'test-results-accessibility',testDir:'./tests/auth',testMatch:'accessibility.spec.ts',fullyParallel:false,workers:1,
  timeout:90_000,expect:{timeout:15_000},globalSetup:'./tests/auth/global-setup.mjs',
  reporter:[['list'],['html',{outputFolder:'playwright-accessibility-report',open:'never'}]],
  use:{baseURL:'http://127.0.0.1:4174',trace:'off',reducedMotion:'reduce'},
  projects:[
    {name:'chromium-desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},
    {name:'chromium-mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium',viewport:{width:390,height:844}}},
    {name:'webkit-desktop',use:{...devices['Desktop Safari'],viewport:{width:1440,height:900}}},
    {name:'webkit-mobile',use:{...devices['iPhone 13'],viewport:{width:390,height:844}}},
  ],
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',url:'http://127.0.0.1:4174',reuseExistingServer:false},
});
