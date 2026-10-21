// Accept only protected app paths. Reject protocol-relative URLs, controls,
// encoded separators and auth callback loops; never forward an external origin.
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || /[\\\s%#]/.test(value)) return '/mapas';
  if (!/^\/(?:mapas(?:\/[0-9a-z-]+)?|equipe)(?:\?[^#]*)?$/.test(value)) return '/mapas';
  try {
    const url = new URL(value, 'https://mapa.invalid');
    return url.origin === 'https://mapa.invalid' ? url.pathname + url.search : '/mapas';
  } catch { return '/mapas'; }
}
