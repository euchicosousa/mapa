import { describe, expect, it } from 'vitest';
import { validatePublicConfig } from './config';
const publicKey = 'sb_publishable_test_public_configuration_123';
describe('public configuration boundary', () => {
  it('reports missing fields without throwing', () => { expect(validatePublicConfig({})).toEqual({ status: 'unavailable', fields: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] }); });
  it('accepts public configuration and local HTTP', () => {
    for (const url of ['https://project.supabase.co', 'http://127.0.0.1:54321']) expect(validatePublicConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: publicKey }).status).toBe('ready');
  });
  it('rejects unsafe URLs', () => {
    for (const url of ['javascript:alert(1)', 'http://project.supabase.co', 'https://user:password@project.supabase.co', 'https://project.supabase.co/?secret=1']) expect(validatePublicConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: publicKey }).status).toBe('unavailable');
  });
  it('strips privileged or malformed credentials rather than serializing them', () => {
    const serviceJwt = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`;
    for (const key of ['sb_secret_never_expose_this', serviceJwt, 'invalid']) {
      const result = validatePublicConfig({ VITE_SUPABASE_URL: 'https://project.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key });
      expect(result.status).toBe('unavailable'); expect(JSON.stringify(result)).not.toContain(key);
    }
  });
  it('accepts legacy local anon keys', () => {
    const key = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role: 'anon' })).replace(/=+$/, '')}.signature`;
    expect(validatePublicConfig({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_PUBLISHABLE_KEY: key }).status).toBe('ready');
  });
});
