# 21: Cancelar geração e tratar contexto alterado

**What to build:** Cancelar, excluir ou modificar o contexto durante a geração tem resultado previsível e não insere nós no lugar errado.

**Blocked by:** 20: Gerar quatro filhos com IA e inseri-los diretamente; 11: Mover ramos e ordenar irmãos por controles acessíveis; 17: Excluir mapas com responsável ou administrador

**Status:** done — implementado e verificado em 20/10/2026 com banco/provedor reais e interface desktop/mobile.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Implementar estados terminais e locks de job/mapa do contrato, incluindo fingerprint de título/caminho/filhos, expiração e revalidação de acesso. Mudança em ramo não relacionado permite aplicação sobre revisão atual; contexto relevante diferente retorna stale.
2. Cancelar disputa o mesmo lock da aplicação: cancelled impede commit; se applied venceu, devolver estado aplicado e ação Desfazer, sem prometer cancelamento retroativo.
3. Polling apenas visível, retomada ao reabrir; running >2 min expira ao consultar/iniciar. Fechar aba não desfaz geração. Retry de consulta é seguro e não chama provedor novamente.
4. Testar integração com mover/excluir pai, excluir mapa, transferência de revisão, revogação e edição local pendente; preservar contexto de recuperação do cliente.

## Critérios de aceite

- [x] Cancelar antes da aplicação deixa zero nós novos; resposta tardia não altera isso.
- [x] Cancelar após aplicação informa resultado real, sem apagar edições posteriores.
- [x] Editar ancestral ou filhos durante geração marca stale; editar ramo independente pode concluir.
- [x] Pai/mapa excluído ou acesso revogado impede finalização.
- [x] Reabrir após job aplicado mostra um lote, sem nova geração.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Testes concorrentes controlados no banco: cancel×finalize, delete×finalize, fingerprint e expiração; E2E aba fechada/reaberta e edição em voo.

## Limites desta entrega

Não fazer retry automático pago ou aplicar sugestões obsoletas mediante aprovação.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Concluído em 20/10/2026, sem iniciar o ticket 22.

- `cancel_ai_generation` autorizado exclusivamente pelo solicitante ainda ativo. Job → mapa → vínculo seguem a mesma ordem de locks da finalização; cancelar não modifica nós, revisão ou histórico. Resposta perdida repete o mesmo cancelamento; resultado tardio não reabre estado terminal.
- Se `applied` venceu, retorna o lote real e oferece Desfazer somente quando ele é a próxima ação reversível da sessão. Edições posteriores e rascunhos são preservados. Uso tardio informado pelo worker pode ser reconciliado sem alterar o estado terminal.
- Polling com uma consulta em voo, pausa real em página oculta, retomada imediata ao voltar, retry de consulta inicial e retomada do job do mesmo usuário em aba nova. Nenhuma consulta/cancelamento dispara OpenAI. Resposta antiga `running` não substitui cancelamento/aplicação terminal na tela.
- Fingerprint do título/caminho/filhos cobre edição, adição de filhos e movimento do pai. Ramo independente e transferência de responsabilidade podem aplicar sobre a revisão atual. Mapa/pai excluído, vínculo revogado e prazo vencido impedem a inserção.
- Prazos usam relógio real após aguardar locks, com uma leitura coerente para estado e motivo. A distinção autorizada `MAP_DELETED` preserva o rascunho para exportação verificada; revogação oculta conteúdo e purga o editor/rascunho pelo fluxo existente.
- Controles e mensagens mantêm a interface atual, sem redesenho. A IA segue restrita às contas temporárias de validação, com o orçamento aprovado de 50.000 tokens/dia/workspace, até o ticket 22.

Migrações versionadas, aplicadas e conferidas no histórico do projeto final:

- `20261020205922_cancel_ai_generation.sql`.
- `20261020210109_resume_active_ai_generation.sql`.
- `20261020210651_ai_access_recovery.sql`.
- `20261020211042_ai_cancel_deadline.sql`.

Verificação:

- `npm test`: **112/112**; typecheck, lint, build e verificação de segredos no bundle passaram.
- `node --test tests/integration/ai-concurrency.test.mjs`: **10/10**, com saída real de OpenAI e HTTPs concorrentes no banco final. Depois do último ajuste de prazo, cancelamento/expiração foram repetidos: **2/2**.
- `MAPA_AI_VALIDATION=1 npm run test:e2e:auth -- ai-cancellation.spec.ts`: **12/12**, desktop 1440×900 e mobile 390×844. Inclui resposta perdida, aplicação vencedora, desfazer explícito, aba fechada/reaberta sem nova geração, contexto obsoleto, mapa excluído com rascunho exportado e acesso revogado.
- Regressão E2E do ticket 20 (`ai.spec.ts`): **6/6**.
- Capturas focadas dos controles e conferência a 360 px: **4/4**, sem overflow horizontal.
- `npm run test:rls`: **46/46**.
- Advisors sem erro novo; aviso preexistente de proteção contra senhas vazadas preservado e documentado. Dados/contas/liberações temporários removidos por IDs da execução; nenhuma execução de validação pendente.

Evidências e observações em [evidence/21/README.md](../evidence/21/README.md). Operação e comportamento em [docs/IA.md](../../../docs/IA.md).

Próximo ticket desbloqueado: **22**, ainda não iniciado. Não houve publicação do frontend na Vercel nem liberação geral de IA. Não alterar decisões de produto para contornar falha de teste.
