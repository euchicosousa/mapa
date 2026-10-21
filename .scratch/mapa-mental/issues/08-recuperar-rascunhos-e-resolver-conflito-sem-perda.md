# 08: Recuperar rascunhos e resolver conflito sem perda

**What to build:** Falha de rede, recarga ou edição de outra pessoa não apaga silenciosamente o trabalho local.

**Blocked by:** 06: Criar e editar nós com autoria e salvamento

**Status:** done — implementado e verificado em 19 de outubro de 2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Persistir base, fila, ids e texto em edição no IndexedDB com chaves por conta/workspace/mapa e debounce definido no contrato. Restaurar só após revalidar identidade/acesso.
2. Implementar conflito: pausar envios, oferecer copiar versão local ou descartar local e carregar remota. Copiar cria mapa novo atomicamente com autoria/responsável atuais; reutilizar essa operação no ticket de duplicação.
3. Reautenticação mantém rascunho isolado. Logout com pendências pede sincronizar/exportar cópia local/descartar; limpar após decisão. Exportação de emergência de rascunho é JSON técnico identificado, distinto do formato de backup estável do ticket 18.
4. Bloquear navegação interna com pendências, tentar flush, usar aviso de saída quando suportado. Revogação de acesso limpa material privado e bloqueia recuperação no workspace revogado. Refetch remoto não altera editor sujo.

## Critérios de aceite

- [x] Após perder rede, editar e recarregar na mesma conta recupera texto e fila.
- [x] Duas sessões partindo da revisão 1: segunda escrita conflitante não sobrescreve primeira.
- [x] Salvar versão local como cópia preserva ambas as versões; descartar pede confirmação.
- [x] Troca de conta não mostra rascunho anterior; quota/indisponibilidade do IndexedDB aparece como erro recuperável.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

E2E offline/online, duas sessões, reload, logout e usuário revogado; unitários de máquina de estados e resposta ambígua de commit.

## Limites desta entrega

Não prometer offline completo; IA continua exigindo conexão. Não mesclar árvores automaticamente.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

### Entrega — 19 de outubro de 2026

- IndexedDB real, debounce de 200 ms, flush em blur/visibilitychange/pagehide. Registro com base, fila, IDs, revisão esperada, sessão do comando, texto em edição e solicitação de cópia, isolado por conta/equipe/mapa/sessão do editor. Leitura validada com Zod e recuperação somente após confirmação de identidade, vínculo e acesso no servidor.
- Pedido gravado antes do envio; replay preserva exatamente operação, sessão, revisão e payload. Após resposta ambígua, consulta a cabeça antes de continuar a fila; revisão intermediária com pendências pausa em conflito. Respostas de uma geração/identidade anterior são ignoradas.
- Conflito oferece salvar versão local como novo mapa ou descartar com confirmação. Cópia atômica/idempotente regenera IDs e atribui responsável/autoria à conta atual, source manual. Original intacto. Pedido de cópia congela até confirmação e sobrevive a recarga/resposta perdida.
- Navegação interna com pendências oferece sincronizar, manter rascunho protegido ou exportar antes de continuar. Logout pede sincronizar/exportar/descartar, limpa rascunhos da conta após decisão e não compete com revalidação automática. Expiração mantém rascunho isolado para entrar novamente na mesma conta.
- Falha de quota/escrita avisa e oferece retry/exportação. Falha de leitura inicial pausa a edição para não substituir material ainda não lido; retry revalida conta/acesso e recupera épocas e rascunho. Limpeza de mapa não apaga rascunhos de outros mapas. Revogação de vínculo limpa a conta; épocas transacionais impedem escrita antiga de recriar dados apagados.
- Diálogos Radix com foco/fechamento, alvos de toque e escala neutra. Painel e gestos do ticket 07 preservados. JSON técnico de emergência identificado, separado do backup estável futuro.

Detalhes operacionais e limites: [docs/RASCUNHOS.md](../../../docs/RASCUNHOS.md).

### Banco e segurança

Migração **20261019184928_recover_local_map.sql** aplicada no projeto final **mapa**, ref **bodxafqkqlyfoyfgahyj**, conta **Primary**. O arquivo criado pela CLI foi alinhado ao timestamp efetivamente registrado pelo conector; SQL aplicado não foi editado. Histórico remoto conferido: quatro migrações, sem reset/seed/ambiente extra. Tipos TypeScript regenerados do remoto.

`public.create_map_copy` SECURITY INVOKER delega à função privada com search_path fixo e checagens explícitas. Anon sem EXECUTE; authenticated somente pelas operações finitas. Validação completa da árvore, limites 500 nós/30 níveis, campos estritos e idempotência transacional. Não aceita autores/source do cliente. Advisors de segurança sem novos achados: permanece o INFO intencional de [RLS do log sem política/grant cliente](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) e o WARN anterior de [proteção de senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Configuração Auth não foi alterada nesta entrega.

### Verificações

- `npm run typecheck`, `npm run lint`: passaram.
- `npm test`: **31/31**. Inclui checkpoint antes do envio, quota recuperável, restauração de commit ambíguo com mesma solicitação, pausa por cabeça remota mais nova, cópia congelada/idempotente, revogação, limpeza antes de Salvo, leitura inicial indisponível, edição sem mudança durante request em voo e falha de leitura ao descartar.
- `npm run test:rls`: **21/21**, com Auth e banco reais. Cópia preserva original, atribui autoria e IDs novos, replay retorna mesma cópia, árvores inválidas/limites/metadados forjados recusados sem mapas parciais; C/D/anon e usuário revogado não copiam, inclusive em replay. Identidades/recursos temporários removidos por IDs.
- `npm run test:e2e`: **15/15**, shell sem configuração em 1440×900, 390×844 e 360 px; sem regressão pública.
- `npm run test:bundle`: dois cenários passaram; chave privilegiada e variáveis não aprovadas ausentes do frontend.
- `npm run build`: passou. Avisos conhecidos de comentários PURE do Zod e chunk principal acima de 500 kB permanecem: principal **737,20 kB**, editor **199,43 kB**. Otimização de escala segue no ticket 24.

**E2E autenticado — registro preciso:** a rodada completa `npm run test:e2e:auth` executou **38 cenários**, com **35 aprovados e três falhas de sincronização nos testes**, execução `20261019-8ec390`, limpa. As duas ocorrências do teste de troca A→C navegavam antes de terminar o login; ele passou a aguardar a rota autenticada. O teste mobile de quota tentava clicar no botão depois de um checkpoint automático já ter recuperado o armazenamento e removido o aviso; ele agora aceita esse sucesso somente após verificar o aviso removido e o registro efetivamente persistido. Nenhuma asserção de isolamento ou durabilidade foi removida.

Reexecução final `npm run test:e2e:auth -- tests/auth/login.spec.ts tests/auth/drafts.spec.ts --grep 'switching A to C|unavailable or full storage'`: **4/4** em desktop/mobile, execução `20261019-1b59f1`, limpa. Esses quatro casos abrangem as três falhas da rodada completa e o cenário desktop de quota. Assim, todos os 38 cenários têm aprovação na implementação final, combinando a rodada integral e a reexecução focada; não houve rodada integral única 38/38 nesta entrega.

Os oito cenários novos, em cada tamanho, cobrem:

1. Escritas sem rede, rascunho inválido de 501 caracteres, backend indisponível na recarga (dados privados ocultos), acesso revalidado e recuperação/sincronização.
2. Duas sessões partindo da revisão 1: primeira versão intacta, segunda conflitante; cópia com resposta perdida, reload e replay idêntico, responsável/autoria atuais.
3. Navegação com rascunho durável, preservação ao abrir outro mapa inexistente, cancelamento do descarte e confirmação para carregar a versão remota.
4. Falha de quota, exportação técnica e recuperação do armazenamento, preservando o texto em memória.
5. Sessão expirada, rascunho de B oculto para A, recuperação por B e logout com tentativa de sincronizar/exportação/limpeza.
6. Revogação de vínculo temporário: conteúdo e rascunho removidos, cópia indisponível.
7. Commit aplicado com resposta perdida: recarga repete o pedido original antes da próxima edição, sem duplicação.
8. Leitura inicial indisponível: edição pausada, rascunho não sobrescrito e recuperação posterior após verificar acesso.

Regressão do editor do ticket 06 e navegação do 07 passaram em desktop/mobile na rodada integral. Capturas revisadas em [evidence/08](../evidence/08): conflito, cópia confirmada, rascunho inválido recuperado, confirmação de descarte, quota, logout com pendências e revogação.

### Ajustes encontrados durante a execução

Os testes revelaram uma corrida de revalidação com o redirect de logout e uma recarga rápida que podia ressuscitar o rascunho antigo depois de Salvo. Corrigidos: a ação explícita controla sua transição Auth; limpeza local é concluída antes de anunciar Salvo. Regressões direcionadas passaram **6/6** (`20261019-3daa2d`, limpa), e os fluxos do editor passaram também na rodada integral posterior. Leitura inicial e limpeza por mapa foram reforçadas para preservar material ainda não lido e rascunhos de outros mapas. Não se alteraram regras de produto para contornar testes.

### Limpeza e limites

Conferência final somente leitura na Primary: **1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações, 0 usuários de validação**, igual à base anterior. `.validation-runs` vazia. Sem alterações em contas/acesso reais da equipe. Migração é a única mudança estrutural remota; sem deploy.

Emulação Chromium com viewport/toque não equivale a Safari ou aparelho físico. Não há offline completo: recarga depende de carregar o frontend e revalidar acesso online; rascunho fica protegido quando isso falha. Fechamento forçado/limpeza/evicção do navegador não garante persistência. JSON de emergência ainda não tem importação na interface; backup portátil permanece nos tickets 18–19. Sem configuração externa pendente para esta fatia.

Referências consultadas: [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB), [useBlocker](https://reactrouter.com/api/hooks/useBlocker), [segurança da Data API](https://supabase.com/docs/guides/api/securing-your-api), changelog Supabase e tipos das bibliotecas instaladas.

**Resultado final: done. Próximo recomendado: 09, ainda não iniciado.**
