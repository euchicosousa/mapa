// Headed real-app fixture for assistive-technology sampling. No credentials are
// printed or persisted; stop with Enter to close the browser and clean exact IDs.
import { setTimeout, clearTimeout } from 'node:timers';
import { chromium } from '@playwright/test';
import { createRun, cleanupRun, readTarget } from './validation-run.mjs';
const target = readTarget(),
  run = await createRun(target);
let browser;
try {
  browser = await chromium.launch({ headless: false, args: ['--force-renderer-accessibility'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:4176/login');
  await page.getByLabel('E-mail', { exact: true }).fill(run.accounts[0].email);
  await page.getByLabel('Senha', { exact: true }).fill(run.accounts[0].password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Novo mapa', exact: true }).click();
  await page.getByLabel('Orientação para a IA (opcional)', { exact: true }).waitFor();
  console.log(`Amostra de acessibilidade pronta; execução ${run.runId}. Pressione Enter para limpar.`);
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
    process.once('SIGINT', resolve);
  });
} finally {
  process.stdin.pause();
  try {
    let timer;
    try {
      await Promise.race([
        browser?.close(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Fechamento do navegador excedeu o prazo.')), 10_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await cleanupRun(target, run.runId);
  }
}
