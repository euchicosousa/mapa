// Explicitly authorized real inbox check. No links, tokens or passwords in output.
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { readTarget, createRun, trackUser, cleanupRun } from './validation-run.mjs';
const inboxFile = '/private/tmp/mapa-password-mail-link.json';
const target = readTarget();
if (target.ref !== 'bodxafqkqlyfoyfgahyj' || process.env.MAPA_PASSWORD_EMAIL !== 'ochicosousa@gmail.com')
  throw Error('Authorized recipient and project required');
await rm(inboxFile, { force: true });
const run = await createRun(target);
const proof = {
  runId: run.runId,
  startedAt: new Date().toISOString(),
  recipient: process.env.MAPA_PASSWORD_EMAIL,
  cleaned: false,
};
let browser;
try {
  const admin = createClient(target.url, target.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // createUser refuses a preexisting address: never take over a real identity.
  const made = await admin.auth.admin.createUser({
    email: proof.recipient,
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
  });
  if (made.error || !made.data.user)
    throw Error('Temporary identity could not be created; no existing account changed');
  await trackUser(run.runId, made.data.user.id);
  proof.step = 'browser';
  browser = await chromium.launch();
  const requester = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await requester.newPage();
  page.setDefaultTimeout(15000);
  await page.goto('http://127.0.0.1:4174/recuperar-senha');
  await page.getByLabel('E-mail', { exact: true }).fill(proof.recipient);
  await page.getByRole('button', { name: 'Enviar link de recuperação' }).click();
  await page.getByRole('status').filter({ hasText: 'Se houver uma conta' }).waitFor();
  await page.screenshot({ path: '.scratch/mapa-mental/evidence/03/desktop-email-requested.png', fullPage: true });
  proof.requestedAt = new Date().toISOString();
  console.log(JSON.stringify({ phase: 'waiting-inbox', requestedAt: proof.requestedAt, runId: run.runId }));
  const deadline = Date.now() + 240_000;
  let inbox;
  while (Date.now() < deadline) {
    try {
      inbox = JSON.parse(await readFile(inboxFile, 'utf8'));
      break;
    } catch {
      await delay(1000);
    }
  }
  if (!inbox) throw Error('Inbox receipt not available within four minutes');
  proof.step = 'inbox-link';
  const url = new URL(inbox.link);
  if (url.hostname !== `${target.ref}.supabase.co` || url.pathname !== '/auth/v1/verify')
    throw Error('Unexpected email link origin');
  if (url.searchParams.get('redirect_to') !== 'http://127.0.0.1:4174/auth/callback')
    throw Error('Unexpected email callback');
  const receiver = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await receiver.newPage();
  mobile.setDefaultTimeout(15000);
  proof.step = 'open-link';
  await mobile.goto(inbox.link);
  proof.step = 'password-form';
  proof.callbackPath = new URL(mobile.url()).pathname;
  await mobile.getByRole('heading', { name: 'Definir nova senha', exact: true }).waitFor({ timeout: 15000 });
  if (new URL(mobile.url()).hash || new URL(mobile.url()).search) throw Error('Tokens remained in URL');
  await mobile.screenshot({ path: '.scratch/mapa-mental/evidence/03/mobile-real-email-password.png', fullPage: true });
  await mobile.reload();
  const password = randomBytes(24).toString('base64url');
  await mobile.getByLabel('Nova senha', { exact: true }).fill(password);
  await mobile.getByLabel('Confirmar nova senha', { exact: true }).fill(password);
  await mobile.getByRole('button', { name: 'Salvar nova senha' }).click();
  await mobile.getByText('Senha salva. Entre com sua nova senha.').waitFor();
  proof.passwordChanged = true;
  proof.step = 'new-login';
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const login = await fresh.newPage();
  await login.goto('http://127.0.0.1:4174/login');
  await login.getByLabel('E-mail', { exact: true }).fill(proof.recipient);
  await login.getByLabel('Senha', { exact: true }).fill(password);
  await login.getByRole('button', { name: 'Entrar', exact: true }).click();
  await login.getByRole('heading', { name: 'Sua conta não tem vínculo ativo' }).waitFor();
  proof.newPasswordLogin = true;
  proof.crossBrowser = true;
  proof.tokensRemoved = true;
  proof.receivedMessageId = inbox.messageId;
  await login.getByRole('button', { name: 'Sair', exact: true }).click();
  await login.waitForURL('**/login');
  await mobile.goto(inbox.link);
  await mobile.getByRole('heading', { name: 'Link inválido ou expirado' }).waitFor();
  proof.usedLinkRejected = true;
  proof.step = 'complete';
} catch {
  proof.failed = true;
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    await cleanupRun(target, run.runId);
    proof.cleaned = true;
  } catch {
    proof.cleanupFailed = true;
    process.exitCode = 1;
  }
  await rm(inboxFile, { force: true });
  await writeFile('.scratch/mapa-mental/evidence/03/real-email.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
}
