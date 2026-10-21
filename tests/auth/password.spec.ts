import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import type { Run } from '../../scripts/validation-run.mjs';
const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run;
if (!run) throw Error('Validation run required');
function link(kind: 'recovery' | 'invite', userId?: string): {link:string;email:string;password:string} {
  const result=spawnSync(process.execPath,['scripts/password-validation.mjs'],{input:JSON.stringify({runId:run.runId,kind,userId}),encoding:'utf8',stdio:['pipe','pipe','pipe']});
  if(result.status!==0)throw Error('Could not prepare password validation');
  return JSON.parse(result.stdout);
}
for (const kind of ['recovery','invite'] as const) {
  test(`${kind}: consume in a fresh browser, reload, change password and sign in`, async ({page,browser},testInfo)=>{
    const account=run.accounts.find(a=>a.key==='B')!;
    const prepared=link(kind,account.id);
    // This requesting context has no PKCE verifier or session passed to the receiver.
    await page.goto('/recuperar-senha');
    const receiver=await browser.newContext({viewport:testInfo.project.use.viewport,isMobile:testInfo.project.name==='mobile',hasTouch:testInfo.project.name==='mobile'});
    const target=await receiver.newPage();
    try {
      // Never let Playwright print bearer URLs on a navigation failure.
      try {await target.goto(prepared.link);} catch {throw Error('Validation link navigation failed');}
      await expect(target.getByRole('heading',{name:'Definir nova senha',exact:true})).toBeVisible();
      expect(new URL(target.url()).hash).toBe('');expect(new URL(target.url()).search).toBe('');
      await target.reload();
      await expect(target.getByLabel('Nova senha',{exact:true})).toBeVisible();
      await target.getByLabel('Nova senha',{exact:true}).fill(prepared.password);
      await target.getByLabel('Confirmar nova senha',{exact:true}).fill(prepared.password+'x');
      await target.getByRole('button',{name:'Salvar nova senha'}).click();
      await expect(target.getByRole('alert')).toContainText('não coincidem');
      await target.getByLabel('Confirmar nova senha',{exact:true}).fill(prepared.password);
      await target.getByRole('button',{name:'Salvar nova senha'}).click();
      await expect(target.getByText('Senha salva. Entre com sua nova senha.')).toBeVisible();
      expect(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await target.getByLabel('E-mail',{exact:true}).fill(prepared.email);
      await target.getByLabel('Senha',{exact:true}).fill(prepared.password);
      await target.getByRole('button',{name:'Entrar',exact:true}).click();
      await expect(target).toHaveURL(kind==='invite'?/sem-acesso$/:/mapas$/);
      await target.getByRole('button',{name:'Sair',exact:true}).click();
      await expect(target).toHaveURL(/login$/);
      try {await target.goto(prepared.link);} catch {throw Error('Reused link navigation failed');}
      await expect(target.getByRole('heading',{name:'Link inválido ou expirado'})).toBeVisible();
      expect(new URL(target.url()).hash).toBe('');expect(new URL(target.url()).search).toBe('');
      await target.getByRole('link',{name:'Solicitar novo link'}).click();
      await expect(target.getByRole('heading',{name:'Recuperar senha',exact:true})).toBeVisible();
      await target.screenshot({path:`.scratch/mapa-mental/evidence/03/${testInfo.project.name}-${kind}.png`,fullPage:true});
    } finally {await receiver.close();}
  });
}
test('invalid and incomplete links cannot unlock a password form',async({page})=>{
  for(const path of ['/auth/callback#error=access_denied&error_code=otp_expired&error_description=PRIVATE_MARKER','/auth/callback#access_token=PRIVATE_MARKER&type=recovery','/definir-senha']){
    await page.goto(path);
    await expect(page.getByRole('heading',{name:'Link inválido ou expirado'})).toBeVisible();
    await expect.poll(()=>new URL(page.url()).hash).toBe('');expect(new URL(page.url()).search).toBe('');
    await expect(page.getByLabel('Nova senha',{exact:true})).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('PRIVATE_MARKER');
  }
});
