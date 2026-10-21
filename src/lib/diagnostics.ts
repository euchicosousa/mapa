// Only fixed categories and route templates cross this boundary. Never accept
// an Error, message, stack, URL, map title, identifier or authentication value.
type FailureKind = 'runtime' | 'promise' | 'route';
type Diagnostic = { kind: FailureKind; route: string; version: string; at: string };
const records: Diagnostic[] = [];
function routeTemplate() {
  const path = window.location.pathname;
  if (/^\/mapas\/[^/]+$/.test(path)) return '/mapas/:id';
  return [
    '/',
    '/login',
    '/recuperar-senha',
    '/auth/callback',
    '/definir-senha',
    '/sem-acesso',
    '/mapas',
    '/equipe',
  ].includes(path)
    ? path
    : '/404';
}
export function captureFailure(kind: FailureKind) {
  const record = { kind, route: routeTemplate(), version: __APP_VERSION__, at: new Date().toISOString() };
  records.push(record);
  if (records.length > 20) records.shift();
  console.warn('Mapa: falha registrada', record);
}
export function readDiagnostics() {
  return records.map((record) => ({ ...record }));
}
export function connectDiagnostics() {
  const error = () => captureFailure('runtime');
  const rejection = () => captureFailure('promise');
  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', rejection);
  return () => {
    window.removeEventListener('error', error);
    window.removeEventListener('unhandledrejection', rejection);
  };
}
