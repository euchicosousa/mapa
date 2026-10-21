import { corsHeaders } from '@supabase/supabase-js/cors';

// Exact development origins only. Publication adds its HTTPS origin explicitly
// through MAPA_ALLOWED_ORIGINS; preview wildcards are intentionally unsupported.
export const developmentOrigins = [5173, 4173, 4174, 4175].flatMap(port => [
  `http://127.0.0.1:${port}`, `http://localhost:${port}`,
]);
export function allowedOrigins(value?: string): Set<string> {
  if (value === undefined) return new Set(developmentOrigins);
  const origins = new Set<string>();
  for (const entry of value.split(',').map(part => part.trim()).filter(Boolean)) {
    try {
      const url = new URL(entry);
      const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.hostname.includes('*')
        || url.username || url.password || url.pathname !== '/' || url.search || url.hash) continue;
      origins.add(url.origin);
    } catch { /* Invalid configuration never grants browser access. */ }
  }
  return origins;
}

// CORS limits browser origins, not identity. Origin-free server clients still
// reach the handler and must pass its JWT/membership/role checks independently.
export function withAllowedOrigins(handler: (request: Request) => Promise<Response>, configured?: string) {
  const origins = allowedOrigins(configured);
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin');
    if (origin !== null && !origins.has(origin)) return new Response(JSON.stringify({ error: 'ORIGIN_NOT_ALLOWED' }), {
      status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' },
    });
    const response = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await handler(request);
    const headers = new Headers(response.headers);
    headers.delete('Access-Control-Allow-Origin');
    if (origin !== null) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', corsHeaders['Access-Control-Allow-Headers']);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    const vary = headers.get('Vary');
    headers.set('Vary', vary ? `${vary}, Origin` : 'Origin');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
