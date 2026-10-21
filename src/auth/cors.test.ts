import { expect, it, vi } from 'vitest';
import { allowedOrigins, withAllowedOrigins } from '../../supabase/functions/_shared/cors';
import { createGenerationHandler, type Service } from '../../supabase/functions/generate-children/handler';

it('normalizes exact HTTPS/local origins, rejecting wildcards, credentials, paths and nonlocal HTTP', () => {
  expect([
    ...allowedOrigins(
      'https://MAPA.example/,https://mapa.example,http://127.0.0.1:4174,https://*.vercel.app,http://mapa.example,https://user:pass@mapa.example,https://mapa.example/path,null',
    ),
  ]).toEqual(['https://mapa.example', 'http://127.0.0.1:4174']);
  expect(allowedOrigins('')).toEqual(new Set());
  expect([...allowedOrigins()]).not.toContain('*');
});
it('allows approved preflight without invoking the business handler and includes current SDK trace headers', async () => {
  const business = vi.fn(async () => new Response('ok'));
  const response = await withAllowedOrigins(
    business,
    'https://mapa.example',
  )(new Request('https://function.example', { method: 'OPTIONS', headers: { Origin: 'https://mapa.example' } }));
  expect(response.status).toBe(204);
  expect(business).not.toHaveBeenCalled();
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://mapa.example');
  expect(response.headers.get('Access-Control-Allow-Headers')).toContain('traceparent');
  expect(response.headers.get('Vary')).toContain('Origin');
});
it('refuses unapproved, null and deceptive origins before business logic; no wildcard fallback', async () => {
  const business = vi.fn(async () => new Response('ok'));
  const handler = withAllowedOrigins(business, 'https://mapa.example');
  for (const origin of ['https://mapa.example.evil.test', 'https://other.vercel.app', 'null']) {
    for (const method of ['OPTIONS', 'POST']) {
      const response = await handler(new Request('https://function.example', { method, headers: { Origin: origin } }));
      expect(response.status).toBe(403);
      expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    }
  }
  expect(business).not.toHaveBeenCalled();
});
it('CORS never substitutes for JWT authorization, with or without Origin, and adds headers to denied responses', async () => {
  const service: Service = {
    authenticate: vi.fn(async () => null),
    available: vi.fn(),
    reserve: vi.fn(),
    finish: vi.fn(),
  };
  const background = vi.fn();
  const handler = createGenerationHandler({ service, background, allowedOrigins: 'https://mapa.example' });
  for (const origin of [undefined, 'https://mapa.example']) {
    const headers: Record<string, string> = { Authorization: 'Bearer invalid-token' };
    if (origin) headers.Origin = origin;
    const response = await handler(new Request('https://function.example', { method: 'POST', headers }));
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin ?? null);
  }
  expect(service.reserve).not.toHaveBeenCalled();
  expect(background).not.toHaveBeenCalled();
});
