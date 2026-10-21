# 31: Limitar o crescimento do registro de operações

**What to build:** Criar uma política de retenção para `public.map_operations`, que hoje cresce sem limite e guarda snapshots completos em JSON.

**Blocked by:** 30: Consolidar as migrações em uma base

**Status:** ready-for-agent — divisão aprovada pelo usuário em 21/10/2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Contexto

Cada operação grava `after_data` (e snapshots de antes, nas operações estruturais); uma exclusão de ramo pode carregar até 500 nós. Nenhuma migração apaga linhas dessa tabela. O registro cumpre três papéis, e a retenção precisa respeitar todos:

- **Idempotência:** um reenvio com o mesmo `operationId` devolve o primeiro resultado (`apply_map_command` lê `map_operations` pelo id). Rascunhos locais podem guardar operações já enviadas por tempo indeterminado.
- **Desfazer/refazer:** `apply_map_history` deriva o inverso dos snapshots; a pilha do cliente guarda até 100 entradas por sessão.
- **Resultado da IA:** `private.ai_job_json` lê `after_data` via `ai_generations.applied_operation_id`.

## Implementação definida

1. Medir o tamanho atual da tabela e a taxa de crescimento por mapa; registrar no ticket.
2. Definir a regra com o usuário. Proposta: manter as últimas N operações por mapa (por exemplo 200) e tudo dos últimos X dias (por exemplo 30); o resto pode ser removido, ou ter os snapshots esvaziados mantendo id, `request_hash` e revisão.
3. Garantir que um reenvio de operação removida devolva `CONFLICT` (a revisão esperada já não bate), que o cliente trata hoje preservando o rascunho. Cobrir com teste.
4. Garantir que desfazer uma operação removida devolva erro tratado, com mensagem clara na interface, sem travar o editor.
5. Ajustar `ai_job_json` para lidar com `after_data` ausente.
6. Agendar a limpeza (`pg_cron` ou Edge Function agendada), em lotes, sem lock longo.

## Critérios de aceite

- [ ] A regra de retenção aprovada pelo usuário está documentada em `docs/OPERACAO.md`.
- [ ] Testes de integração cobrem: reenvio de operação removida, desfazer de operação removida e leitura de geração de IA antiga.
- [ ] A limpeza roda agendada, em lotes, e registra quantas linhas removeu.
- [ ] Nenhuma operação dentro da janela de retenção é afetada.

## Como verificar

Teste de integração com operações antigas criadas para a execução e limpas ao final; consulta de contagem antes e depois no banco final.

## Limites desta entrega

Não mudar o formato das operações nem o limite de 100 entradas da pilha do cliente.

## Dependências externas

Decisão do usuário sobre os valores de retenção. `pg_cron` habilitado no projeto, se for o mecanismo escolhido.

## Registro do executor

Pendente.
