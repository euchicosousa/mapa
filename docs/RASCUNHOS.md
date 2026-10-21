# Rascunhos e conflitos — ticket 08

## Uso

O editor protege alterações pendentes no navegador. Após recarregar, entre na mesma conta, abra o mesmo mapa e use **Tentar novamente** para sincronizar o rascunho recuperado. O app confirma novamente a identidade, o vínculo ativo e o acesso ao mapa antes de mostrar dados locais.

Se outra sessão salvou primeiro, o envio pausa. **Salvar minha versão como cópia** cria um mapa separado, atribuído à conta atual, sem alterar o original. **Descartar alterações locais** pede confirmação e só abandona o trabalho local depois de conseguir ler a versão remota. Não há mesclagem automática.

Ao navegar com alterações pendentes, é possível sincronizar, continuar mantendo um rascunho protegido ou exportar antes de continuar. No logout deliberado, escolher sincronizar, exportar ou descartar; depois da saída, os rascunhos dessa conta são removidos deste navegador. Expiração de sessão preserva o rascunho para reautenticação na mesma conta.

## Armazenamento

- IndexedDB `mapa.drafts.v1`, stores `drafts` e `epochs`.
- Chave do rascunho: `[userId, workspaceId, mapId, editorSessionId]`. A sessão do editor usa UUID em `sessionStorage` para sobreviver à recarga.
- Registro versionado validado com Zod: documento-base confirmado, fila com IDs e metadados da solicitação, texto em edição, seleção, conflito, reconciliação eventual pedido de cópia e pedidos de histórico sem confirmação (ticket 10).
- Debounce de 200 ms; flush em blur, visibilitychange e pagehide. Antes de enviar um comando, grava o pedido completo. A limpeza do último rascunho acontece antes de anunciar Salvo.
- Não guarda senha, refresh token, access token ou chave administrativa nos rascunhos. Auth continua no mecanismo próprio do SDK.
- Operações IndexedDB esperam o término da transação. Escritas são serializadas. Épocas por conta e por mapa invalidam escritas antigas depois de uma limpeza, inclusive de outra sessão aberta.
- Logout deliberado ou vínculo revogado limpa a conta. Um mapa inexistente/sem acesso limpa somente o escopo daquele mapa, preservando rascunhos de outros mapas.

Quota/indisponibilidade de escrita exibe aviso, mantém o trabalho em memória e oferece tentar novamente ou exportar. Se a **leitura inicial** falhar, a edição pausa para não substituir um rascunho que ainda não pôde ser lido; a tentativa posterior verifica de novo conta/acesso e recupera o registro existente. Não se troca IndexedDB por um armazenamento simulado.

## Resposta perdida

O primeiro envio fixa `operationId`, `editorSessionId`, `expectedRevision`, tipo e payload. A retomada repete exatamente esse pedido. Depois de uma resposta ambígua, consulta a cabeça remota antes de enviar o próximo comando. Se há revisão intermediária de outra sessão e alterações locais restantes, pausa em conflito; sem pendências, adota a cabeça atual. Respostas atrasadas de um documento/identidade anterior não alteram o editor atual.

A cópia mantém seu pedido congelado em disco até confirmação. A edição dessa versão pausa; retry e recarga repetem o pedido original. A operação `create_map_copy` também pode ser reutilizada na duplicação do ticket 16.

O ticket 10 acrescenta `pendingHistory` e `undoRequested` opcionais ao registro v1, preservando compatibilidade com rascunhos anteriores. Antes de desfazer/refazer, grava a referência da operação, modo, revisão e identificadores da solicitação; nenhum snapshot de autoria do navegador é enviado ao servidor. Um desfazer solicitado durante uma escrita guarda seu alvo até a escrita resolver. Em falha/recarga, a mesma solicitação é repetida e a cabeça remota é conferida antes de liberar novas edições. As pilhas completas de histórico continuam restritas à sessão.

## Banco

Migração `20261019184928_recover_local_map.sql`, aplicada no Supabase Primary, projeto `bodxafqkqlyfoyfgahyj`.

`public.create_map_copy` é SECURITY INVOKER e delega à função privada com `search_path` fixo, identidade e acesso explícitos. Não há EXECUTE para anon. Ela valida árvore completa (uma raiz, IDs únicos, pais existentes, conectividade, ausência de ciclos, até 500 nós e profundidade 30), bloqueia operação/mapa, cria mapa/nós e registra a operação na mesma transação. IDs são regenerados, responsável e autores são a conta atual, source é manual. Metadados de autoria/source enviados pelo cliente são recusados. Retry idêntico retorna a mesma cópia; acesso revogado continua sendo recusado no replay.

## Limites

Não é um modo offline completo. Recarregar precisa carregar o frontend e confirmar acesso no servidor; se o backend não responder, o app oculta dados privados e oferece tentar novamente, mantendo o rascunho armazenado. Sem service worker/PWA, não se promete abrir o frontend sem rede. Escritas locais também dependem das garantias do navegador: encerramento forçado, limpeza de dados, navegação privada ou evicção podem remover o armazenamento. Eventos de saída não garantem conclusão de uma transação pendente.

O arquivo de emergência usa `format: mapa-emergency-draft`, versão 1, e aviso explícito de que não é backup portátil. É um artefato técnico para preservação e recuperação assistida; esta fatia não inclui importação desse arquivo na interface. O backup estável e sua importação continuam nos tickets 18–19.

Verificação por Chromium emulado não equivale a teste em Safari ou aparelho físico. Nenhum deploy integra esta entrega.
