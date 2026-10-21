# Entrega da versão funcional — 21/10/2026

**Disponível em https://mapa.cnvt.com.br.** Projeto Vercel mapa/agenciacnvt, deploy `dpl_2qdMEvn4UEELuRscohiVBnqcFCJz`, build `0.1.0+2026-10-21T11:59:12.983Z`. O aceite do ticket 28 usou essa versão publicada; não alterou o produto, o visual ou o banco.

Os tickets 01–28 foram concluídos. O usuário deixou seus testes pessoais, novas funcionalidades e revisão visual para a próxima etapa. Esta entrega comprova os cenários executados; não substitui avaliação de usabilidade pelo usuário nem teste em celular físico.

## Aceite final

**14/14 cenários aprovados na primeira rodada conjunta, sem retries automáticos**, com contas temporárias no Supabase final, durante a execução `20261021-30fdf6`.

| Verificação | Resultado |
| --- | --- |
| Admin convida; membro aceita e cria mapa | Aprovado em desktop/mobile |
| Adicionar, mover, recolher, expandir, editar, excluir e desfazer | Aprovado; persistência conferida no banco |
| IA real insere quatro filhos diretamente | Aprovado; autoria, lote único e desfazer/refazer conferidos |
| Outra conta abre/edita e responsável é transferido | Aprovado; criador do nó preservado e editor atualizado |
| Exportar/importar backup portátil | Cópia com novos IDs, mesma estrutura/ordem/textos; original inalterado |
| Conflito entre duas sessões | Versões preservadas; descarte local explícito abre a versão salva |
| Falha de escrita na rede e recarga | Falha injetada só no navegador de teste; rascunho recuperado e salvo após reconexão |
| Retirada de acesso | Documento ocultado e conta sem vínculo ativo impedida de continuar |
| Login, callback, recuperação, convite, links diretos e 404 | Aprovados na URL oficial |

Foram usadas contas Auth reais descartáveis. Os links de senha dessa rodada foram gerados pelo serviço administrativo para essas contas; não se afirma novo recebimento em caixa humana. O SMTP e recebimento real no Outlook já foram comprovados no ticket 26, incluindo a classificação como spam.

IA: duas chamadas reais ao modelo `gpt-6-luna`, uma por viewport. Desktop: 230 tokens de entrada + 95 de saída = **325**. Mobile: 233 + 100 = **333**. Total **658 tokens**, iguais à contabilização do servidor. Cada lote foi aplicado antes de seu desfazer/refazer; não houve aceite prévio dos filhos. O teto aprovado de 50.000 tokens/dia UTC por equipe foi preservado. O valor monetário exato não estava disponível; não foi estimado nem apresentado como cobrança confirmada.

Ambiente: Chromium **156.0.8078.4**, Playwright 1.64.1, Mac Apple Silicon, desktop 1440×900 e mobile emulado 390×844. Conferência adicional de ausência de overflow em 768 e 360 px. Capturas desktop/mobile revisadas pelo executor. Não foi usado aparelho móvel físico; a avaliação pessoal do usuário está pendente por escolha dele.

Typecheck e lint aprovados. Nenhuma mudança de implementação do frontend, migração, função remota, segredo ou limite foi necessária. Os 129 testes unitários/componentes e build do ticket 27 permanecem a referência da mesma implementação; não são apresentados como reexecutados neste ticket.

## Evidências e operação

Evidências em `.scratch/mapa-mental/evidence/28/`: resumos do fluxo e resiliência por viewport, uso real de IA, backups portáteis de validação, capturas, ambiente e conferência de limpeza. Resumo consolidado em `verification-summary.json`. Senhas/tokens não integram esses arquivos. Traces e vídeo desativados.

Todos os recursos temporários foram limpos por IDs exatos. Consulta posterior confirmou zero contas e espaços dessa execução remanescentes, zero registros locais pendentes e preservação do administrador operacional. Contas/mapas reais da CNVT não foram usados para alterar acesso ou senha nos testes.

O [guia de uso](GUIA-DE-USO.md) orienta a equipe; o [runbook](OPERACAO.md) reúne publicação, migrações, configurações, backups e incidentes. Recuperação do frontend em [DEPLOY.md](DEPLOY.md). A referência atual mantém as 33 migrações já conferidas; não houve nova migração ou restauração.

## Limitações e continuidade

- Backup do provedor reconferido: WAL-G ativo, PITR desabilitado e nenhum ponto listado. Não há ponto integral de restauração confirmado; nenhuma restauração destrutiva foi executada. Backup portátil foi validado como cópia no mesmo banco e não recupera Auth/equipe/histórico.
- Desempenho em 200/500 nós consta em [DESEMPENHO.md](DESEMPENHO.md); acessibilidade e amostra VoiceOver em [ACESSIBILIDADE.md](ACESSIBILIDADE.md). Essas medições anteriores não foram repetidas nem ampliadas para hardware físico neste aceite.
- Isolamento/autoria/integridade e risco residual de proteção contra senhas vazadas estão em [SEGURANCA.md](SEGURANCA.md). Os registros de falha do cliente são locais e efêmeros, sem alertas centralizados. A intermitência observada no login durante o ticket 27 permanece documentada, embora a rodada final 28 tenha passado sem repetição.
- A próxima etapa é o uso pessoal do usuário para levantar falhas, melhorias, novas funcionalidades e mudanças de visual. Nenhuma dessas mudanças foi antecipada nesta entrega.
