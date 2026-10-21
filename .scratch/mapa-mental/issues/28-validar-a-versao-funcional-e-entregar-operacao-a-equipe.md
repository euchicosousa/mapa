# 28: Validar a versão funcional e entregar operação à equipe

**What to build:** Confirmar que a equipe consegue executar o fluxo completo com IA real, desktop e mobile, e deixar instruções de uso e manutenção.

**Blocked by:** 27: Publicar a SPA e validar links diretos

**Status:** done — concluído em 21/10/2026; testes pessoais do usuário e mudanças futuras de visual/funcionalidades ficam para depois, conforme solicitado.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Executar roteiro completo no ambiente publicado: admin convida membro → membro cria mapa → adiciona/move/recolhe nós → gera filhos IA → edita/remove/desfaz → outra pessoa abre/edita → transfere responsável → exporta/importa.
2. Repetir conflito com duas sessões, falha de rede, recuperação de senha, revogação de acesso e abertura mobile. Confirmar IA real com uso registrado e sem aprovação prévia.
3. Consolidar evidências dos testes/performance e pendências. Manual breve de uso e runbook com deploy, migrations, backup do app validado por importação como cópia no mesmo banco e recuperação de banco documentada sem execução destrutiva, configurações e incidentes comuns.
4. Atualizar estado de tickets e checklist final somente com evidência. Sem credencial/modelo/SMTP/aparelho necessários, registrar verificação bloqueada em vez de chamar versão funcional validada.

## Critérios de aceite

- [x] Dois membros completam fluxo compartilhado com autoria e responsável corretos.
- [x] IA real insere lote diretamente e desfazer funciona; custo/uso da validação registrado sem segredos.
- [x] Fluxos principais passam em desktop e mobile; registrar navegadores/aparelhos efetivamente usados.
- [x] Importação de backup como cópia no banco final preserva estrutura; somente a cópia de validação é removida, sem restore/reset do banco.
- [x] Manual, runbook, URL e pendências estão entregues; nenhum critério crítico fica marcado como aprovado sem execução.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Roteiro E2E e checagem humana em ambiente real, com logs de validação e evidência de resultados; fixtures locais nunca substituem smoke final.

## Limites desta entrega

Não acrescentar novas funcionalidades. Corrigir falhas de aceite antes de encerrar.

## Dependências externas

Duas contas autorizadas, IA configurada, SMTP e acesso a navegador móvel para validação final.

## Registro do executor

Aceite executado em https://mapa.cnvt.com.br, deploy `dpl_2qdMEvn4UEELuRscohiVBnqcFCJz`, build `0.1.0+2026-10-21T11:59:12.983Z`. Nenhuma alteração de produto, visual, banco, funções remotas, segredos ou limites. O usuário determinou que seus testes pessoais e sugestões de funcionalidades/visual serão posteriores; essa checagem humana não é alegada como executada.

`npx playwright test --config playwright.acceptance.config.ts`: **14/14 aprovados**, sem retries, em Chromium 156.0.8078.4 / Playwright 1.64.1. Desktop 1440×900 e mobile emulado 390×844; conferência adicional em 768/360 px, capturas revisadas. Não foi usado aparelho físico.

Fluxo completo por viewport: administrador convida conta descartável, membro aceita/cria mapa, adiciona/move/recolhe/expande nós, gera quatro filhos IA diretamente, desfaz/refaz o lote, edita/remove/desfaz, colega abre/edita preservando autor, transfere responsável, exporta e importa como cópia no banco final. IDs novos, texto/ordem/relações iguais e autoria da importação conferidos; original inalterado. Somente a cópia descartável é excluída no teste de recuperação, e depois todos os recursos da execução são limpos por IDs. Desativação por admin retira acesso e oculta documento. Duas sessões reais reproduzem conflito; confirmação explícita abre versão remota. Falha de escrita injetada apenas no navegador preserva rascunho após recarga; reconexão e retry salvam. Regressão pública inclui login, recuperação, callback/invite reais, senha, biblioteca/editor, histórico de navegação e 404.

IA real `gpt-6-luna`: duas chamadas. Desktop 230 entrada + 95 saída = 325 tokens; mobile 233 + 100 = 333. Total **658**, igual ao uso contabilizado no servidor; IDs, modelo, horários e usage preservados em evidência sem segredos. Sem aprovação dos filhos antes de aplicar. Orçamento de 50.000 tokens/dia UTC/workspace preservado. Cobrança exata em moeda não estava disponível e não foi estimada. Não há adaptação falsa no produto. Os links Auth desta rodada foram gerados administrativamente para contas temporárias; prova de entrega SMTP humana do ticket 26 foi mantida, sem afirmar novo recebimento nesta rodada.

Entrega: `docs/GUIA-DE-USO.md`, `docs/OPERACAO.md`, `docs/ENTREGA.md`, índice README atualizado e procedimento de deploy/rollback existente em DEPLOY.md. Relatórios anteriores de desempenho, acessibilidade e segurança referenciados, sem apresentá-los como repetidos. Typecheck/lint aprovados. Mesmo frontend publicado do ticket 27, sem necessidade de novo deploy ou migração; permanece referência de 33 migrações.

Backup do provedor reconferido: WAL-G ativo, PITR desabilitado e nenhum ponto listado. Nenhum backup integral/restore ou reset executado; limitações e recuperação lógica documentadas. Riscos residuais conhecidos (spam no Outlook, proteção contra senhas vazadas não habilitada, registro de falhas só local e emulação móvel) permanecem explícitos na documentação. Não se promete aparelho físico, edição simultânea, offline completo, restauração integral confirmada ou custo monetário não observado.

Evidências em ../evidence/28/, resumo `verification-summary.json`. Execução `20261021-30fdf6` limpa; consulta posterior: zero contas e workspaces dessa execução, zero registros locais pendentes, administrador operacional `agenciacnvt@gmail.com` preservado. Senhas e tokens não foram gravados nas evidências. Status final **done**; pacote 01–28 encerrado. Próxima etapa: avaliação pessoal do usuário, sem iniciar novas funcionalidades ou redesenho.
