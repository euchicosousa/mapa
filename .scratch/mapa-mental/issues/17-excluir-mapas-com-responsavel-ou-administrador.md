# 17: Excluir mapas com responsável ou administrador

**What to build:** Remover um mapa da biblioteca com confirmação e impedir novas edições nele.

**Blocked by:** 14: Transferir responsabilidade sem restringir a edição

**Status:** done — verificado no Primary, desktop e mobile em 20/10/2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Adicionar soft delete versionado de mapa somente para owner/admin. Modal mostra título; confirmar define deleted_at atomicamente.
2. Biblioteca/editor/operadores e funções IA devem tratar mapa excluído como indisponível. Dados retidos ficam inacessíveis pelo cliente normal; RLS não pode permitir leitura direta de nodes do mapa excluído.
3. Sessões abertas recebem erro tipado ao salvar, preservando local somente enquanto acesso à equipe continua, sem restaurar automaticamente o mapa.
4. Operação repetida é idempotente; redirecionar à biblioteca após confirmação.

## Critérios de aceite

- [x] Responsável/admin exclui, membro comum é negado mesmo chamando API.
- [x] Mapa some da busca e URL direta não revela conteúdo.
- [x] Nós de mapa excluído não são consultáveis diretamente.
- [x] Sessão antiga não consegue recriar mapa ao salvar.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

E2E duas sessões e confirmação; RLS nodes/maps após soft delete.

## Limites desta entrega

Sem lixeira pública, restauração ou destruição física automática nesta versão.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Executado em **20/10/2026**, exclusivamente no projeto final **Primary / bodxafqkqlyfoyfgahyj**. Bloqueador 14 conferido. Nenhuma configuração externa faltante ou integração simulada.

### Entrega

- Responsável/admin encontra **Excluir mapa** nos detalhes. A confirmação identifica o título; cancelar antes de confirmar não envia operação. A exclusão exige conteúdo anterior salvo, serializa uma solicitação e retorna à biblioteca após confirmação do servidor. Fechar a confirmação depois do envio não promete cancelar uma operação já iniciada.
- Comando versionado `delete_map`, payload vazio, revisão esperada, checagem de membro ativo e papel, lock de mapa/vínculo, incremento único e registro da operação. Apenas `deleted_at`, revisão e último editor mudam; dados dos nós e autoria ficam retidos. Não há escrita direta concedida ao cliente.
- Repetição idempotente da mesma exclusão confirmada retorna apenas revisão/timestamp/ator e `deletedAt`, sem título ou nós. Replays antigos de conteúdo/histórico, novas edições e cópia de recuperação são bloqueados após exclusão. Não se pode recriar o mapa pela sessão antiga.
- RLS de mapas, nós e preferências já exigia mapa ativo; foi preservada e verificada por leitura direta. Biblioteca e URL direta não devolvem conteúdo retido.
- O código público continua `NOT_FOUND`. O detalhe `MAP_DELETED` só é retornado a membros ativos, sem conteúdo, para distinguir exclusão de perda de acesso. Sessão antiga com rascunho fica em tela sem canvas, com exportação de emergência e retorno à biblioteca. Alterações locais ficam isoladas no IndexedDB, sem restauração/cópia automática.
- Exportação verifica novamente o vínculo no Primary antes de gerar arquivo. Revogação impede download, oculta a tela e limpa os rascunhos da conta. Resposta tardia após sair da tela não dispara exportação. Falha de verificação mantém o registro e não concede acesso.
- Exclusão confirmada com resposta perdida permanece como solicitação original. Depois de recarregar, **Confirmar exclusão pendente** repete ID/revisão/sessão/payload e retorna à biblioteca, sem incrementar outra vez.
- Migrações **20261020130503_soft_delete_maps.sql** e **20261020130940_recheck_deleted_map_after_lock.sql**, criadas pela CLI, revisadas, conferidas por dry-run e aplicadas uma vez. A segunda é correção aditiva da classificação após lock concorrente; nenhuma migração aplicada foi editada. Wrappers públicos SECURITY INVOKER, helpers privados com auth/vínculo e search_path vazio. Tipos gerados do Primary; 16 versões locais/remotas conciliadas.

### Validação

- `npm run typecheck`, `npm run lint`: passaram.
- `npm test`: **64/64**, 11 arquivos. Inclui exclusão somente após confirmação canônica, bloqueio de novas mutações, preservação do rascunho para membro ativo, remoção por revogação e replay idêntico sem reler documento excluído.
- `npm run test:rls`: **39/39 reais**. Matriz owner/admin/member/externo/anon; autoria/dados retidos intactos; consultas diretas de mapas/nós/preferências vazias; biblioteca sem resultado; replay de conteúdo/histórico e cópia negados; revogação remove também o motivo de exclusão; concorrência edição/exclusão deixa uma revisão vencedora e não permite restaurar.
- Suíte combinada `deletion.spec.ts`, `library.spec.ts` e `ownership.spec.ts`: **12/12**, sendo 6 de exclusão, 2 de biblioteca e 4 de transferência, em **1440×900 e 390×844**. Cancelar/confirmação, redirecionamento, URL indisponível, duas sessões, rascunho após reload e resposta perdida verificados contra o Primary.
- Proteção final do rascunho (`--grep 'admin deletes'`): **2/2**, desktop/mobile. Exportação autorizada; nenhum download após sair da tela durante uma resposta real retida; desativação real e temporária do membro de teste impede nova exportação, redireciona a sem-acesso e deixa zero rascunhos da conta. Vínculo restaurado no finally. Helper administrativo aceita somente membro não administrador e IDs registrados pela própria execução.
- Histórico dos testes: primeira suíte 4/6 por seletor que procurava um link como botão; ajustado, suíte seguinte 6/6. Depois, conjunto 12/12 e proteção final 2/2. Falhas não foram contornadas com backend fictício.
- `npm run build` e `npm run test:bundle`: passaram. Principal **770,21 kB**, editor **220,99 kB**. Avisos preexistentes Zod/PURE e chunk >500 kB seguem para otimização no 24.
- Advisors sem novos achados; permanecem INFO intencional de `map_operations` sem política/grants de cliente, WARN de proteção de senhas vazadas desativada e avisos de desempenho anteriores.
- Limpeza final: **1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações, 0 projetos, 0 preferências e 0 usuários de validação**. Registros temporários vazios. Limpeza apenas por IDs da execução; conteúdo anterior preservado.

### Evidências e limites

[Resultados](../evidence/17/resultados.json), [catálogo/políticas/contagens](../evidence/17/backend-proof.json), [segurança](../evidence/17/security-advisors.json), [desempenho](../evidence/17/performance-advisors.json), capturas [desktop](../evidence/17/desktop/) e [mobile](../evidence/17/mobile/). Uso em `docs/BIBLIOTECA.md`.

Sem lixeira pública, restauração, hard delete automático ou exportação portátil dos tickets 18–19. IA ainda não está disponível; suas operações futuras devem verificar mapa ativo ao iniciar e aplicar. Sem deploy e sem iniciar outra fatia.

**Status final: done. Total: 13/28 concluídos, 15 restantes. Próximo na sequência recomendada: 16.**
