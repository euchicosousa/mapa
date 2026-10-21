# 22: Limitar uso de IA e expor falhas recuperáveis

**What to build:** A equipe usa IA dentro de limites definidos e entende quando deve aguardar ou corrigir configuração.

**Blocked by:** 21: Cancelar geração e tratar contexto alterado

**Status:** done — concluído em 20/10/2026; IA liberada para membros ativos com teto aprovado de 50.000 tokens/dia UTC por workspace.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Aplicar limites atômicos do contrato antes do provedor: uma ativa/usuário, 10/minuto/usuário, 100/dia UTC/workspace e reserva de tokens diária. Parâmetros somente servidor, obrigatórios em produção.
2. Usar contador/reserva transacional, identificadores idempotentes e reconciliar usage; se custo desconhecido, manter reserva conservadora. Não liberar orçamento por simples cancelamento de chamada já enviada.
3. Exibir mensagens distintas para limite, provedor indisponível, timeout e configuração faltante, sem expor segredos. Retry explícito só após estado terminal; cooldown/rate limit não dispara retry automático.
4. Registrar correlação, latência, status e tokens sem texto de mapas. Documentar configuração de limite de gasto do provedor e limpeza de resultados temporários. Concluir smoke real quando variáveis estiverem disponíveis.

## Critérios de aceite

- [x] Requisições simultâneas no último saldo não ultrapassam a reserva disponível.
- [x] Mesmo generationId não debita novamente; cancelamento após envio não recupera saldo arbitrariamente.
- [x] Bloqueio por limite não chama modelo; UI permanece editável.
- [x] Logs não contêm texto do cliente, chaves, senhas ou tokens.
- [x] Um smoke real gera e salva lote válido, com uso registrado, ou permanece explicitamente bloqueado.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Testes de concorrência e fronteira de dia UTC; capturar chamadas do adapter para provar limite; inspecionar logs e smoke controlado.

## Limites desta entrega

Sem painel financeiro/billing. Limite em tokens não deve ser apresentado como preço garantido.

## Dependências externas

Configuração de modelo, credencial e orçamento para smoke real; aprovação humana do orçamento antes de uso real.

## Registro do executor

Entrega em 20/10/2026 no projeto final `mapa` (`bodxafqkqlyfoyfgahyj`). Migração aditiva `20261020213609_ai_usage_ledger.sql`, aplicada uma vez pela CLI remota e confirmada no histórico; tipos públicos regenerados do projeto. Edge Function `generate-children` publicada com handler de dependências testáveis e adaptador real. Sem Docker, staging, reset, endpoint falso ou alteração de acesso da equipe.

O servidor serializa reservas por usuário/workspace, guarda contador diário UTC e reserva de 17.000 tokens por pedido. Tetos: uma ativa/usuário, 10/minuto/usuário, 100/dia/workspace e 50.000 tokens/dia/workspace, conforme orçamento aprovado. Replay não debita novamente; custo desconhecido permanece reservado. Uso conhecido é reconciliado exatamente uma vez no dia original, inclusive em falha/cancelamento, sem reabrir job terminal. Tabelas de parâmetros, contador e eventos são privadas e sem acesso dos clientes.

A interface informa limites e horário de nova tentativa, diferencia falhas de configuração/provedor/timeout e mantém o mapa editável. A espera nunca dispara geração automática. O adaptador preserva uso conhecido também em recusa/saída inválida e não repete chamada paga. Logs permitem somente correlação, estado, código, duração e contagem de tokens.

Verificações:

- `npm test`: 122/122; `npm run lint`, `npm run typecheck`, `npm run build` e `npm run test:bundle`: aprovados. Avisos de bundle/tamanho e comentários de dependência preexistentes, sem falha.
- `tests/integration/ai-limits-transactions.sql`, via CLI `db query --linked`: aprovado, rollback; fronteira UTC, janela móvel, 100/dia, cancelamento, uso inválido, reconciliação tardia e privilégios.
- `tests/integration/ai-transactions.sql`: regressão aprovada, rollback; fixtures com uso conhecido respeitam agora o teto de 50.000 sem ampliar orçamento.
- `node --test tests/integration/ai-budget.test.mjs`: 3/3; dois usuários disputam último saldo, apenas uma reserva; replay/cancelamento não devolvem saldo desconhecido; cliente não altera uso.
- `npm run test:rls`: 46/46, identidades e dados descartáveis removidos.
- `MAPA_AI_VALIDATION=1 npm run test:e2e:auth -- ai-limits.spec.ts`: 4/4 em 1440×900 e 390×844, também sem overflow em 360 px. Rejeição HTTP 429 real mantém edição/salvamento e faz somente um pedido de geração. Smoke real inseriu quatro filhos em uma revisão: 295 tokens no desktop e 337 no mobile, reconciliados com o banco.
- Logs reais: 15 eventos inspecionados na janela iniciada às 22:00 UTC; zero ocorrências do marcador enviado no texto e de padrões de credenciais. Evidência segura em `../evidence/22/verification.json`; screenshots em `../evidence/22/desktop` e `../evidence/22/mobile`.
- Advisors: tabelas privadas/RLS sem policies e `map_operations` negam acesso por desenho. Aviso preexistente `auth_leaked_password_protection` permanece para revisão da publicação; [referência](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Configuração de limite financeiro do provedor e retenção/limpeza documentadas em `docs/IA.md`. Nenhum valor monetário foi escolhido ou alterado. Limite de tokens não é garantia de preço; a configuração financeira deve ser conferida antes da publicação, como determina o contrato.


Regressão final: `MAPA_AI_VALIDATION=1 npm run test:e2e:auth -- ai.spec.ts ai-cancellation.spec.ts` passou 18/18. Após ativar `private.ai_settings.enabled=true`, `MAPA_AI_ROLLOUT=1 npm run test:e2e:auth -- ai-limits.spec.ts -g 'real smoke'` passou 2/2 com contas comuns, sem allowlist. Evidências de liberação em `../evidence/22/rollout`.

Limpeza final confirmada: zero contas/workspaces/jobs de validação e zero liberações temporárias de IA; `.validation-runs` vazio. Dados reais da equipe preservados. **Status final: done.** Tickets 23, 24 e 25 ficam desbloqueados; nenhum foi iniciado nesta execução.
