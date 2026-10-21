# 34: Dividir a tela do editor em componentes menores

**What to build:** Separar `src/routes/editor.tsx` em arquivos por responsabilidade e remover cálculos repetidos a cada renderização.

**Blocked by:** 33: Simplificar o estado do editor

**Status:** ready-for-agent — divisão aprovada pelo usuário em 21/10/2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Contexto

`src/routes/editor.tsx` tem 584 linhas e reúne o canvas do React Flow, a navegação por teclado, a restauração de foco, o painel do nó, o diálogo de mover, o painel de recuperação e o indicador de salvamento. O `NodePanel` recalcula os descendentes do nó selecionado percorrendo todos os nós a cada renderização (`descendantCount`), embora `descendantCounts` já seja calculado no `MapEditor`. O `MoveDialog` chama `reorganize` para cada candidato a cada renderização.

## Implementação definida

1. Criar `src/routes/editor/` com: `index.tsx` (rota e `MapEditor`), `canvas.tsx` (React Flow, `MindNode`, controles e teclado), `node-panel.tsx`, `move-dialog.tsx`, `recovery-panel.tsx` e `save-indicator.tsx`.
2. Passar a contagem de descendentes já calculada para o painel, ou calculá-la com `useMemo`.
3. Memorizar a lista de candidatos e a checagem de profundidade do `MoveDialog`.
4. Manter o `lazy` da rota apontando para o novo `index.tsx`, preservando o chunk separado do editor.

## Critérios de aceite

- [ ] Nenhum arquivo do editor passa de cerca de 250 linhas.
- [ ] `npm run test:a11y`, `npm run test:performance` e `npm run test:e2e:auth` passam; as métricas de desempenho com 200 e 500 nós não pioram em relação ao registro do ticket 24.
- [ ] `npm run test:bundle` passa e o editor continua num chunk separado.
- [ ] Fluxo verificado em 390×844 e 1440×900.

## Como verificar

Suítes citadas e comparação com as métricas do ticket 24.

## Limites desta entrega

Sem mudanças visuais nem de comportamento. O redesenho visual é outra etapa.

## Dependências externas

Banco final para as suítes autenticadas.

## Registro do executor

Pendente.
