# 20: Gerar quatro filhos com IA e inseri-los diretamente

**What to build:** Selecionar um nó e pedir IA acrescenta quatro filhos reais, identificados pelo solicitante, com opção de desfazer.

**Blocked by:** 08: Recuperar rascunhos e resolver conflito sem perda; 10: Desfazer e refazer alterações próprias; 07: Navegar pelo mapa com layout e gestos mobile

**Status:** done — implementado e verificado em 20/10/2026 com Supabase/OpenAI reais, desktop/mobile e limite provisório autorizado.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Criar ai_generations, reserva de job e finalização atômica conforme contrato; executar no Edge Function com identidade validada. Ler contexto autorizado no servidor. Job idempotente impede duplo clique de chamar provedor duas vezes.
2. Implementar adaptador OpenAI Responses com AI_MODEL, schema de quatro textos, timeout e validação de saída. Controles básicos: uma geração ativa/usuário e capacidade de nós; recurso desativado para uso geral até ticket 22; smoke restrito e com limites no projeto final conforme contrato. Sem chave/modelo, retornar indisponível, não gerar mock.
3. UI mostra botão Gerar caminhos com IA, orientação opcional e progresso; aguardar salvar nó antes de iniciar. Resposta válida é aplicada pelo worker no banco, com source=ai, requested_by e operação de lote. Sem painel de aprovação.
4. Reconciliar job aplicado no editor sem sobrescrever fila pendente; usar regras do contrato e conflito do ticket 08. Atualizar autoria, layout e histórico; Desfazer remove lote como uma ação se ainda for topo.
5. Suportar recusa/saída inválida/timeout com estado failed e nenhuma inserção. Testes usam adaptador falso determinístico; registrar smoke real pendente se faltarem configuração/credenciais.

## Critérios de aceite

- [x] Uma solicitação válida insere exatamente quatro filhos no mapa sem clique de aceite.
- [x] Nós indicam “Gerado com IA por [solicitante]”; outro membro vê a mesma autoria.
- [x] Desfazer/refazer lote preserva ramos anteriores e metadados.
- [x] Saída inválida ou indisponibilidade não cria nós; repetição de id não duplica cobrança intencional ou inserção.
- [x] Texto digitado durante geração não é substituído silenciosamente pela resposta.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Testes de schema/adapter, transação finalização e E2E fake apenas em teste; smoke com provedor real após configuração. Testar usuário externo e source forjado.

## Limites desta entrega

Entrega integrada ao projeto final, ainda desativada para uso geral; cancelamento/corridas completos no 21 e orçamento no 22 são obrigatórios antes de liberar IA à equipe. Não implementar chat ou streaming de nós incompletos.

## Dependências externas

OPENAI_API_KEY e AI_MODEL para smoke real; sem eles, implementar/testar adapter falso e registrar verificação real bloqueada.

## Registro do executor

Implementação concluída em 20/10/2026:

- Jobs idempotentes com claim exclusivo, contexto autorizado no banco e finalização atômica com quatro nós. IDs/autoria/proveniência gerados no servidor; uma operação `ai_children`, compatível com histórico LIFO e restauração de ramos IA.
- Edge Function `generate-children`, Auth validado no handler e JWT obrigatório no gateway. Adaptador OpenAI Responses com o `AI_MODEL` configurado pelo usuário (`gpt-6-luna`), schema estrito, validação local, timeout 45s e nenhum retry automático cobrado. Recusa/JSON inválido/repetição/indisponibilidade não insere nós.
- Orientação opcional, progresso, consulta de job por segundo com página visível, recuperação de resposta perdida/recarga e reconciliação conservadora. Fila em voo é aguardada; rascunhos e revisões desconhecidas usam o conflito existente, preservando texto.
- Recurso fechado à equipe até 22; somente contas descartáveis de validação recebem acesso temporário. Segredos enviados ao armazenamento do projeto final após autorização explícita do usuário. Teto provisório aprovado: 50.000 tokens/dia/workspace. Reserva conservadora, uso reconciliado e cotas mínimas no servidor limitam os smokes.
- Textos/contexto não são logados. Resultado do job é reconstruído do log autorizado de operações, sem cópia permanente no job. Chave OpenAI não entra no bundle.

Migrações aplicadas no projeto final e conferidas no histórico:

- `20261020170405_ai_generations.sql`.
- `20261020170632_ai_validation_access.sql`.
- `20261020171005_ai_worker_permissions.sql`.
- `20261020171102_ai_result_retention.sql`.

Verificações:

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:bundle`: passaram.
- `npm test`: 85/85.
- `npm run test:rls`: 46/46.
- `tests/integration/ai-transactions.sql`: passou em transação com rollback no projeto final; reserva idempotente, lote atômico, histórico, contexto, outros ramos, falhas, revogação, isolamento, expiração, orçamento e capacidade.
- `MAPA_AI_VALIDATION=1 npm run test:e2e:auth -- ai.spec.ts`: 6/6 em 1440×900 e 390×844, com OpenAI/Supabase reais. Repetição concorrente e perda da resposta inicial mantiveram um lote; desfazer/refazer, recarga, autoria para colega e texto digitado durante geração foram verificados.
- Edição desktop: 1/1. Regressão mobile de nós/rascunhos: 9/9.
- Conferência visual adicional de 360 px: 1/1, sem overflow horizontal.
- Contas, mapas e liberações das execuções foram removidos pelos IDs registrados. SQL de validação integralmente revertido. Sem alteração de contas/mapas reais.

Evidências em [evidence/20/README.md](../evidence/20/README.md), documentação operacional em [docs/IA.md](../../../docs/IA.md).

Limites da fatia: cancelamento completo permanece em 21; controles completos de uso e liberação geral em 22. Sem publicação do frontend na Vercel. Próximo ticket desbloqueado: **21** (20, 11 e 17 concluídos). Nenhum trabalho do ticket 21 foi iniciado. Não alterar decisões de produto para contornar falha de teste.
