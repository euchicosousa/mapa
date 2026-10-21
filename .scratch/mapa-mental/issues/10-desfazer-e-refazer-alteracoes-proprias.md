# 10: Desfazer e refazer alterações próprias

**What to build:** Reverter criação, texto e exclusão durante a sessão recupera conteúdo e autoria corretos.

**Blocked by:** 09: Excluir um ramo preservando a integridade do mapa

**Status:** done — implementado e verificado em 19 de outubro de 2026; ticket 09 revalidado nesta execução.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Implementar histórico de comandos registrados no servidor: add_child, edit_text, delete_subtree. Inverso gerado de before/after confiáveis; endpoint exige acesso, sessão/ator e revisão compatível.
2. Manter pilhas locais limitadas a 100 entradas. Coalescer edição concluída, invalidar redo ao criar nova ação. Desfazer ainda pendente cancela/coalesce localmente; operação em voo deve resolver idempotentemente antes de inversão.
3. Restaurar ids e autoria de snapshot servidor; atualização direta ou payload de snapshot do browser permanece proibido.
4. Botões acessíveis e atalho nativo só fora de campos. Operação externa invalida histórico com explicação; nunca desfazer trabalho de outra sessão.

## Critérios de aceite

- [x] Criar/editar/excluir ramo pode ser desfeito e refeito preservando criadores.
- [x] Nova ação após undo limpa redo; falha de undo não avança pilha.
- [x] Undo de operação alheia/antiga é negado no servidor.
- [x] Um clique repetido durante undo não gera duas inversões.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; nenhuma infraestrutura ausente nesta execução.

## Como verificar

Testes de sequência de comandos, operações em voo, reconstrução de ramo e conflito entre sessões; E2E teclado e botões mobile.

## Limites desta entrega

Histórico não precisa sobreviver ao encerramento da sessão; registro de operações continua persistente.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

### Entrega

- `apply_map_history` recebe apenas referências: operação alvo, modo undo/redo, mapa, sessão, operação idempotente e revisão. O servidor revalida vínculo/acesso antes de qualquer replay, bloqueia operação/mapa, reconstrói as pilhas pelo log imutável e aceita somente a cabeça própria da sessão. Operações de outra sessão formam uma barreira; uma ação nova limpa redo também no servidor. Não é possível recuperar redo descartado ou voltar a ações anteriores à barreira após fazer uma ação nova.
- Criação, edição e exclusão são invertidas com os snapshots gerados pelo servidor. Restauração insere pais antes dos filhos, conserva IDs, texto, estrutura, criadores, último editor e source. A árvore inteira é validada após a inversão: raiz única, conectividade, capacidade e profundidade. Cada inversão confirma uma revisão e um registro; repetição idêntica, inclusive concorrente, retorna a mesma resposta sem nova revisão. Replay com acesso revogado é negado.
- Pilhas locais têm até 100 entradas. Digitação é coalescida; texto ainda pendente e comandos não enviados podem ser desfeitos localmente e refeitos. Nova ação limpa redo na criação da ação, sem deixar uma confirmação antiga apagar redo criado depois. Refetch de mesma revisão preserva a pilha; mudança externa a invalida com explicação.
- Desfazer solicitado durante uma gravação guarda o alvo e pausa novas edições até a confirmação idempotente da gravação e a inversão. `pendingHistory` guarda o pedido completo antes da rede, e `undoRequested` guarda a intenção em voo. Ambos são opcionais no rascunho v1 para compatibilidade. Falha não avança pilhas, repete o mesmo pedido/revisão e preserva a recuperação após recarga; depois do replay confere a cabeça remota. Respostas de um documento anterior são ignoradas.
- Botões Desfazer/Refazer acessíveis em desktop/mobile. Com foco no canvas, Ctrl/Cmd+Z e Ctrl/Cmd+Shift+Z; campos preservam o atalho nativo. Nó removido pelo histórico devolve a seleção a um ancestral existente. Estados de espera/falha são textuais e novas ações ficam pausadas durante a confirmação.

### Banco e migrações

Projeto final **mapa**, ref **bodxafqkqlyfoyfgahyj**, conta **Primary**. Migrações versionadas aplicadas e histórico remoto conferido:

1. `20261019211658_undo_redo_map_operations.sql`: API e inversões a partir dos logs.
2. `20261019212454_restore_subtree_snapshot_root.sql`: ramo inicia no nó cujo pai permanece fora do snapshot.
3. `20261019220703_validate_history_stack_order.sql`: ordem de múltiplas inversões.
4. `20261019220923_avoid_snapshot_alias_collision.sql`: versão final com alias sem colisão, pilhas reconstruídas do log, barreira externa, invalidação de redo, autorização antes de replay, validação completa da árvore e índices do histórico.

As versões anteriores já aplicadas foram preservadas; correções são novas migrações. O conector apresentou expiração de requestState durante tentativas; conferido o histórico antes de retomar. A última migração foi aplicada pela CLI remota após dry-run confirmar somente ela pendente. `db.migrations.enabled=true` permite esse fluxo versionado; seeds e serviços locais continuam desativados. Sem Docker, reset, staging ou deploy. Tipos da API foram gerados do projeto remoto.

Wrapper público SECURITY INVOKER; implementação privada SECURITY DEFINER com `search_path` vazio. Anon sem EXECUTE, authenticated com EXECUTE; cliente sem escrita direta em nós e sem leitura do log. [Prova remota](../evidence/10/backend-proof.json).

Skill Supabase aplicada; documentação oficial de [funções](https://supabase.com/docs/guides/database/functions) e changelog consultados. Nenhuma mudança do changelog exigiu adaptação das funções SQL desta fatia. Advisors sem achado novo de segurança. Permanecem o INFO intencional do log sem grant/política cliente e o WARN anterior de proteção contra senhas vazadas desativada: [INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### Verificações finais

- `npm run typecheck`, `npm run lint`: passaram.
- `npm test -- --pool=threads --maxWorkers=1`: **42/42**, 7 arquivos. Inclui limite 100, cancelamento local/refazer, resposta perdida com recarga, espera pela escrita em voo, alvo congelado, falha sem avanço e invalidação em refetch externo.
- `npm run test:rls`: **26/26**, Auth e banco Primary reais. Criação/texto/exclusão com undo/redo, ramo de três níveis restaurado exatamente com autoria mista, ordem A/B → undo B/A → redo A/B, alvo antigo/alheio, novo comando limpa redo, barreira externa, revisão antiga, modo inválido, usuários sem acesso, revogação inclusive no replay e duas chamadas concorrentes com uma única inversão. Inclui a regressão integral do ticket 09.
- `npm run test:e2e:auth -- tests/auth/canvas.spec.ts --grep 'deletes a three-level|undo and redo controls|another editor session|history with a committed|undo waits for a real'`: **10/10**, execução **20261019-66248b**, limpa. Cinco fluxos em **1440×900** e **390×844**: exclusão/cancelamento/restauração/refazer do ramo e remoção de folha; botões/atalhos/edição e novo comando limpa redo; operação externa; resposta real confirmada mas perdida com replay após recarga; desfazer durante uma gravação real em voo com edição pausada e uma única inversão.
- `npm run build`, `npm run test:bundle`: passaram. Avisos existentes do Zod/PURE e bundle acima de 500 kB continuam; principal **744,57 kB**, editor **201,54 kB**. Otimização permanece no ticket 24.
- Capturas finais revisadas e preservadas em [evidence/10](../evidence/10); resultados em [resultados.json](../evidence/10/resultados.json). Evidência da exclusão do 09 em [revalidacao-10](../evidence/09/revalidacao-10).

Durante a implementação, as suítes identificaram e motivaram as correções de raiz do snapshot, ordem múltipla e colisão de alias. Uma rodada E2E teve falha antes de abrir o mapa no mobile; uma rodada estável posterior passou 8/8 e a rodada final ampliada passou 10/10. Os resultados finais acima correspondem à versão corrigida. O registro da primeira tentativa de validação com rede bloqueada (`20261019-a840ef`) também foi limpo por IDs exatos.

Conferência após todas as limpezas: **1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações e 0 usuários temporários**. Dados reais preservados; nenhum registro de validação restante. Sem configuração externa pendente. Verificação em Chromium emulado, sem aparelho físico ou Safari. As pilhas completas não precisam sobreviver ao encerramento da sessão; somente pedidos ainda não confirmados são duráveis.

**Resultado final: done. Ticket 09 revalidado e permanece done. Próximo recomendado: ticket 11, não iniciado.**
