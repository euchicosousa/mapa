# 24: Medir e otimizar edição de mapas com 200 e 500 nós

**What to build:** O editor permanece responsivo em mapas representativos e possui limites de desempenho medidos.

**Blocked by:** 12: Recolher ramos e lembrar a visualização por pessoa; 22: Limitar uso de IA e expor falhas recuperáveis

**Status:** done — concluído em 20/10/2026; metas de laboratório e critérios verificados, com limitações registradas.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Criar fixtures determinísticas de 200/500 nós respeitando profundidade e textos do contrato. Medir build de produção em aparelho/navegador registrados.
2. Instrumentar latência interação→paint e frames de pan/zoom; separar rede/IA de processamento local. Meta p95 <100 ms para editar/selecionar e próximo de 60 fps em 200 nós, sem tratar emulação como hardware real.
3. Corrigir rerenders amplos, seletores, cálculo de layout e conexões; se layout bloquear, mover cálculo puro para worker mantendo geometria equivalente. Avaliar renderizar apenas visíveis com medição, evitando quebrar layout/seleção.
4. Verificar que recolher remove descendentes renderizados, lazy editor funciona e biblioteca não carrega nós. Registrar antes/depois e limites em 500 nós; limitar suporte conforme contrato, sem prometer milhares.

## Critérios de aceite

- [x] Relatório reproduzível inclui hardware, navegador, build, amostras e resultados em 200/500 nós.
- [x] Metas de 200 nós atingidas no ambiente registrado ou ticket permanece aberto com causa mensurada.
- [x] Otimização não altera ordem, texto, autoria, seleção ou desfazer.
- [x] Sem requisição de banco por frame/pan; 500 nós não causam perda de dados.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Benchmark local repetível e smoke funcional após otimização; validar mobile em dispositivo disponível, registrando qualquer pendência de hardware.

## Limites desta entrega

Sem trocar renderer/framework por hipótese. Worker só após evidência; não reduzir funcionalidade silenciosamente.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Executado em 20/10/2026 (America/Fortaleza). Build de produção medido no Mac M4/16 GB com Chromium 156.0.8078.4, 1440×900 e 390×844 (mobile emulado). [Relatório de desempenho](../../../docs/DESEMPENHO.md) registra ambiente, metodologia, amostras, hashes e limites; [evidências](../evidence/24/) contêm oito séries de produção e as capturas correspondentes, além dos dois ensaios de CPU.

- Fixtures determinísticas de 200/500 nós, seis filhos/pai, Unicode e textos de alturas variadas. Testes usam RPCs reais, contas/equipes descartáveis no projeto final, sem IA.
- Uma passagem calcula todos os totais de descendentes. Nó visual memoizado e referências de nós/dados preservadas quando só a seleção muda. Dimensões medidas preservadas; layout, renderer e semântica de edição não mudaram.
- Em 200 nós: seleção p95 34,6 ms (desktop)/35,1 ms (emulado); edição p95 15,0/15,6 ms; pan/zoom cerca de 60 frames rAF/s. Em 500: seleção 35,4/37,5 ms, edição 15,3/15,1 ms, cadência próxima de 60. Proxy após paint e rAF não são INP de campo nem medição óptica de frames; limitação explícita no relatório.
- Contagem de descendentes em 500: p95 2,028 → 0,049 ms no ensaio de CPU. Layout D3 permaneceu abaixo de 1 ms no p95; sem evidência para worker. Renderização de todos os nós atingiu a meta de laboratório; mantida para preservar foco fora da viewport. Recolher remove descendentes do DOM; editor segue lazy e biblioteca não solicita nós.
- Integridade comprovada em 200/500: total, ordem, pais, texto final, autoria/origem, seleção, geometria durante navegação, desfazer/refazer e recarga. Navegação gera somente gravações debounced de preferências, sem requisição de conteúdo por frame.
- `npm test`: 124 testes/20 arquivos. `npm run build` (inclui typecheck), `npm run lint` e `npm run test:bundle`: aprovados.
- Comparação final de produção: quatro casos antes + quatro depois aprovados. `npm run test:performance` repete o estado atual.
- Regressão canvas/preferências: 19/20 na primeira rodada; um caso desktop parou antes de abrir o editor. Repetido isoladamente duas vezes com sucesso, sem mudança de código; falha original e limitação de diagnóstico preservadas no relatório.

Sem migração, deploy, alteração de orçamento ou de segredos. Não se utilizou celular físico; emulação não é evidência de desempenho do hardware móvel. Em 500 nós houve long task de até 84 ms no roteiro completo, detalhada no relatório; suporte continua limitado a 500/30 níveis, sem promessa para milhares de nós.

Regressão adicional de foco/atalhos/toque em Chromium/WebKit nas duas telas: 7/8 na rodada inicial; um caso parou no login e passou duas vezes seguidas na repetição WebKit desktop. Falha inicial preservada, causa de preparação não determinada, sem mudança do editor para contornar testes. Auditorias axe dos cenários aprovados sem violações. Todos os cenários selecionados tiveram execução bem-sucedida, com as intermitências descritas no relatório. Recursos descartáveis limpos em todas as rodadas. Status final: **done**. Próximo ticket autorizado deve ser escolhido separadamente; 25 está desbloqueado.
