# 33: Simplificar o estado do editor

**What to build:** Reescrever o store do editor com um único estado de fase em vez de flags independentes, eliminando duplicações, sem mudar o comportamento visível.

**Blocked by:** 29: Padronizar a formatação do código; 32: Decidir o escopo dos rascunhos offline

**Status:** ready-for-agent — divisão aprovada pelo usuário em 21/10/2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Contexto

`src/state/editor.ts` tem 673 linhas e cerca de 15 flags que se combinam (`inFlight`, `historyBusy`, `pendingHistory`, `undoRequested`, `copyRequest`, `copying`, `needsHeadCheck`, `deleted`, `deleteConfirmed`, `revoked`, `storageInitialized`, `storageError`, `recovered` e outras), além de variáveis fora do store (`undoAfterFlight`, `generation`). Muitas combinações não fazem sentido, mas são representáveis. A mesma cadeia de guarda (`!storageInitialized || copyRequest || historyBusy || pendingHistory || undoRequested || !finishDraft()`) se repete em cerca de 10 ações.

Duplicações identificadas:

- A aplicação de um resultado do servidor sobre `confirmed.nodes` aparece três vezes: em `pump`, `applyHistory` e `integrateAI`.
- O cálculo de descendentes aparece em quatro lugares: `applyLocal`, `deleteSubtree`, `descendantCount` no `NodePanel` e `subtreeIds` em `src/maps/structure.ts`.

## Implementação definida

1. Modelar `phase` como união discriminada (por exemplo: `idle`, `sending`, `history`, `copying`, `conflict`, `error`, `deleted`, `revoked`), com os dados de cada fase dentro dela. `status` passa a ser derivado de `phase`.
2. Criar `canEdit(state)` e `canUseHistory(state)` e usá-las em todas as ações, no lugar das guardas repetidas.
3. Extrair `mergeResult(confirmed, result)` e usá-la nos três pontos.
4. Usar `subtreeIds` em todos os cálculos de descendentes.
5. Trazer `undoAfterFlight` e `generation` para dentro do estado, ou documentar por que precisam ficar fora.
6. Aplicar o escopo de rascunhos decidido no ticket 32.

## Critérios de aceite

- [ ] Todos os testes de `src/state/editor.test.ts` passam sem alterar as expectativas de comportamento; mudanças só na forma de montar o estado são permitidas.
- [ ] `npm run test:e2e:auth` e `npm run test:acceptance` passam contra o banco final.
- [ ] Nenhuma cadeia de guarda duplicada; uma busca por `historyBusy ||` encontra só as funções de permissão.
- [ ] A lógica de mesclar resultado existe uma única vez.
- [ ] O arquivo do store fica claramente menor, com o número de linhas antes e depois registrado no ticket.

## Como verificar

Suítes unitárias, `test:e2e:auth` e `test:acceptance`; revisão do diff focada em equivalência de comportamento.

## Limites desta entrega

Sem mudanças de interface ou de contrato com o servidor, exceto as decorrentes do ticket 32.

## Dependências externas

Banco final para as suítes E2E.

## Registro do executor

Pendente.
