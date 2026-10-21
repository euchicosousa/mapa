// Survives reload, but each tab owns an independent recovery slot.
function sessionId() {
  try {
    const previous = sessionStorage.getItem('mapa.editor-session.v1');
    if (previous && /^[0-9a-f-]{36}$/.test(previous)) return previous;
    const id = crypto.randomUUID();
    sessionStorage.setItem('mapa.editor-session.v1', id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
export const editorSessionId = sessionId();
