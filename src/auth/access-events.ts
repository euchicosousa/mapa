export const ACCESS_DENIED_EVENT='mapa:access-denied';
export function notifyAccessDenied(){window.dispatchEvent(new Event(ACCESS_DENIED_EVENT));}
