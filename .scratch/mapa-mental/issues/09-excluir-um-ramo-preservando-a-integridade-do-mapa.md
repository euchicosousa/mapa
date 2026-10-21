# 09: Excluir um ramo preservando a integridade do mapa

**What to build:** Um membro remove um nó e seus descendentes sem deixar conexões ou dados órfãos.

**Blocked by:** 06: Criar e editar nós com autoria e salvamento

**Status:** done — implementado e verificado em 19 de outubro de 2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Adicionar delete_subtree na transação comum; coletar subtree no servidor, registrar snapshot confiável antes de remover. Raiz não pode ser excluída.
2. UI informa quantidade de descendentes; confirmação quando houver descendentes, remoção simples para folha. Operação visual local e retry pela fila.
3. Após exclusão, selecionar pai e atualizar layout/detalhes. Revalidar permissões, revisão e existência no servidor.
4. Preservar before_data necessário ao histórico do próximo ticket; o cliente não envia snapshot de autoria para o servidor confiar.

## Critérios de aceite

- [x] Remover um ramo de três níveis remove exatamente seus nós; irmãos permanecem.
- [x] Tentar remover raiz ou ramo de outro mapa é rejeitado.
- [x] Cancelamento da confirmação não muda conteúdo nem revisão.
- [x] Falha/retry não perde snapshot nem remove outro ramo.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; nenhuma infraestrutura faltante.

## Como verificar

Testes de transação/subtree, tentativa contra raiz e API alheia; E2E confirmação e seleção do pai.

## Limites desta entrega

Desfazer é entregue no ticket 10; não criar mecanismo provisório separado.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

### Entrega

- `delete_subtree` integra a transação comum. O servidor exige mapa acessível, revisão atual e nó existente no mapa; recusa raiz, nó inexistente/alheio, payload extra e anônimo. Sob o lock do mapa, calcula todos os descendentes, guarda `before_data.nodes` com ids, textos, relações e autoria lidos do banco, apaga o conjunto, aumenta a revisão uma vez e grava o resultado. O cliente nunca fornece o snapshot. Repetir o mesmo `operationId` devolve o resultado e snapshot originais sem nova revisão; outro conteúdo/ator continua em conflito.
- A fila local projeta a remoção, persiste o comando com metadados antes do envio e repete o mesmo pedido em falha. Ao confirmar, o mapa e o IndexedDB são reconciliados com `deletedNodeIds`; o pai do ramo fica selecionado.
- Folhas podem ser removidas diretamente. Um nó com descendentes abre confirmação e informa a quantidade; cancelar deixa conteúdo e revisão intactos. A raiz não mostra ação de exclusão. Diálogo e ações responsivos em desktop/mobile.

### Banco e segurança

Migração **20261019202703_delete_node_subtree.sql** aplicada ao projeto final **mapa**, ref **bodxafqkqlyfoyfgahyj**, conta **Primary**. Histórico remoto conferido. A função privada continua `SECURITY DEFINER` com `search_path` vazio fixo; o wrapper público continua `SECURITY INVOKER`; anon sem EXECUTE e authenticated com EXECUTE. A autorização do mapa é revalidada no servidor dentro da transação. Sem tabela nova, chaves privilegiadas no navegador, reset, staging ou deploy.

O changelog atual não traz breaking change aplicável: esta alteração usa uma função Postgres existente e não adiciona tabela exposta ao Data API. Os advisors de segurança não apontaram achado novo. Permanecem o INFO intencional de `map_operations` com RLS sem política/grant cliente e o WARN anterior de proteção contra senhas vazadas desativada; [INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) · [WARN](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### Verificações

- `npm run typecheck`, `npm run lint`: passaram.
- `npm test -- --pool=threads --maxWorkers=1`: **33/33**, 7 arquivos; inclui projeção otimista do ramo, proteção da raiz e repetição após falha com o mesmo `operationId`.
- `npm run test:rls`: **22/22**, Auth e banco Primary reais. O teste remove um ramo com três nós, confirma irmão, raiz e identificadores de mapa alheio, revisão única, replay idempotente e snapshot confiável com autoria; anon e contas sem acesso não podem editar. Testes criaram e limparam somente recursos temporários.
- `npm run test:e2e:auth -- tests/auth/canvas.spec.ts --grep 'deletes a three-level branch'`: **2/2**, desktop 1440×900 e mobile 390×844, execução `20261019-3937a8`, limpa. Cancelamento não envia comando e uma leitura do servidor confirma revisão igual; confirmação remove o ramo e seleciona o pai; folha é removida sem diálogo.
- `npm run build`: passou. Permanecem avisos existentes de comentários PURE do Zod e do bundle principal acima de 500 kB; principal 737,84 kB, editor 200,34 kB. Otimização pertence ao ticket 24.

As primeiras tentativas encontraram dois problemas somente nos testes (mapa secundário criado no espaço errado e seletores/expectativa de revisão do E2E); corrigidos e a suíte completa RLS e fluxo desktop/mobile foram aprovados na execução final. Capturas do resultado em [evidence/09](../evidence/09).

Conferência final na Primary após limpeza: **1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações, 0 usuários temporários**; igual à base anterior. Sem configuração externa pendente. O comportamento foi validado em emulação Chromium, sem aparelho físico ou Safari.

**Resultado final: done. Próximo desbloqueado: ticket 10; não iniciado nesta execução.**


## Revalidação solicitada durante o ticket 10 — 19 de outubro de 2026

Revalidado no Supabase Primary e na interface desktop/mobile. **Permanece done.** A exclusão do 09 e seus snapshots estavam corretos; as correções da restauração e da ordem do histórico foram entregues nas migrações do 10.

- Suíte real Auth/RLS: **26/26**, incluindo exclusão exata de três níveis, irmão preservado, raiz/IDs alheios negados e replay idempotente. O 10 também restaura exatamente o snapshot do ramo com IDs e autoria mista e o exclui novamente por redo.
- Fluxo autenticado do ramo: **2/2**, desktop 1440×900 e mobile 390×844, dentro da rodada final conjunta **10/10**, execução `20261019-66248b`, limpa. Confirmação cancelada mantém revisão; exclusão mantém irmão e seleciona pai; undo restaura o ramo; redo remove novamente; folha continua com exclusão direta.
- Capturas novas de exclusão em [evidence/09/revalidacao-10](../evidence/09/revalidacao-10); restauração e resultados conjuntos em [evidence/10](../evidence/10).
- Typecheck/lint/build/bundle passaram; **42/42** testes locais. Sem configuração pendente ou nova migração no comando de exclusão do 09.
- Base final preservada: 1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações e nenhum usuário temporário.
