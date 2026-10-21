import { beforeEach, expect, it, vi } from 'vitest';
const sdk=vi.hoisted(()=>({setSession:vi.fn(),getUser:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:{auth:sdk}}));
vi.mock('./privacy',()=>({lockPrivateData:()=>1,unlockPrivateData:vi.fn()}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();sessionStorage.clear();window.history.replaceState(null,'','/login');});
it('accepts only complete recovery/invite fragments and rejects Auth errors',async()=>{
  const {parsePasswordLink}=await import('./password-links');
  for(const kind of ['recovery','invite'])expect(parsePasswordLink(new URL(`https://mapa.test/auth/callback#type=${kind}&access_token=a&refresh_token=b`))?.kind).toBe(kind);
  for(const hash of ['type=signup&access_token=a&refresh_token=b','type=recovery&access_token=a','type=recovery&access_token=a&refresh_token=b&error=expired'])expect(parsePasswordLink(new URL(`https://mapa.test/auth/callback#${hash}`))).toBeNull();
});
it('scrubs tokens before routing and validates the SDK session before granting the form',async()=>{
  window.history.replaceState(null,'','/auth/callback#type=recovery&access_token=a&refresh_token=b');
  sdk.setSession.mockResolvedValue({data:{session:{user:{id:'test-user'},expires_at:Date.now()/1000+3600}},error:null});
  sdk.getUser.mockResolvedValue({data:{user:{id:'test-user'}},error:null});
  const flow=await import('./password-links');
  expect(window.location.hash).toBe('');
  await flow.passwordCallbackLoader();expect(await flow.hasPasswordGrant()).toBe(true);
  expect(sessionStorage.getItem('mapa.password-link.v1')).not.toContain('access_token');
  sdk.getUser.mockResolvedValue({data:{user:{id:'another-user'}},error:null});
  expect(await flow.hasPasswordGrant()).toBe(false);
});
it('does not turn an existing login into a recovery grant',async()=>{
  sdk.getUser.mockResolvedValue({data:{user:{id:'test-user'}},error:null});
  const flow=await import('./password-links');expect(await flow.passwordCallbackLoader()).toEqual({valid:false});expect(await flow.hasPasswordGrant()).toBe(false);
  expect(sdk.setSession).not.toHaveBeenCalled();
});
it('expired local grants are refused without consulting a session',async()=>{
  sessionStorage.setItem('mapa.password-link.v1',JSON.stringify({userId:'test-user',expiresAt:Date.now()-1}));
  const flow=await import('./password-links');expect(await flow.hasPasswordGrant()).toBe(false);expect(sdk.getUser).not.toHaveBeenCalled();
});
it('malformed or expired server sessions never grant a password form',async()=>{
  window.history.replaceState(null,'','/auth/callback#type=invite&access_token=a&refresh_token=b');
  sdk.setSession.mockResolvedValue({data:{session:null},error:{status:401}});
  const flow=await import('./password-links');expect(await flow.passwordCallbackLoader()).toEqual({valid:false});expect(await flow.hasPasswordGrant()).toBe(false);
});
