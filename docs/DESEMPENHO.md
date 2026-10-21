# Desempenho do editor — ticket 24

Medição de laboratório em 20/10/2026 (America/Fortaleza). O suporte continua limitado a 500 nós, profundidade 30 e 500 caracteres por nó. Não extrapolar os resultados para milhares de nós ou aparelhos móveis reais.

## Ambiente e reprodução

Mac16,12, Apple M4, 10 núcleos (4 de desempenho + 6 de eficiência), 16 GB; macOS 26.6.2 (25G83). Node 22.17.0, npm 10.9.2, Playwright 1.64.1, Chromium 156.0.8078.4 headless. React 19.3.1, React Flow 12.12.0, D3 hierarchy 3.1.2, Zustand 5.0.15, Vite 7.3.7. Sem limitação artificial de CPU/rede.

Telas: desktop 1440×900; viewport 390×844 com perfil iPhone 13 **emulado no mesmo Mac/Chromium**, incluindo toque via CDP. Não foi utilizado um celular físico. Os resultados móveis não medem CPU, GPU, temperatura ou bateria de um iPhone.

```sh
npm run test:performance
```

O comando constrói produção, serve `dist` na porta 4175, executa sequencialmente as quatro combinações e mede as funções puras. Exige as mesmas credenciais locais privadas de validação já documentadas em AUTH-SUPABASE.md. Usa o Supabase final `bodxafqkqlyfoyfgahyj`, contas/equipes descartáveis e limpeza por IDs ao terminar. Não chama IA e não muda o orçamento aprovado. Não usar o comando com outra suíte pesada concorrente.

Fixtures em `tests/performance/fixture.ts`: árvores determinísticas com seis filhos por pai, ordem definida, profundidade até quatro arestas, Unicode/quebra de linha e textos de tamanhos variados, dentro do contrato. Importação pela RPC real remapeia UUIDs e atribui autoria manual à conta de teste. SHA-256 das fixtures e do chunk de produção consta em cada JSON. Os builds antes/depois são identificados pelos nomes e hashes dos arquivos, não por um commit: este checkout não possui `.git`.

## Como a medição funciona

Cada combinação coleta 60 seleções alternadas por teclado e 60 caracteres digitados. A amostra começa no `keydown` capturado na página; termina depois da mudança visível correspondente, com `requestAnimationFrame` seguido de uma tarefa. É um **proxy de interação até depois do paint**, não INP de campo nem timestamp físico de apresentação. Inclui a restauração de foco em dois frames que já existia na navegação acessível. O p95 usa nearest rank, separadamente por tamanho/tela.

Event Timing (limiar 16 ms, valores quantizados pelo navegador) e long tasks são guardados como diagnóstico adicional; eventos abaixo desse limiar não aparecem, portanto não se usa a média dos eventos reportados para representar todas as interações. A distinção entre resposta visual local e métrica INP segue a [documentação de INP](https://web.dev/articles/optimize-inp).

Pan: três arrastos de 60 passos, com todos os nós e conexões montados, zoom inicial de 100%. O teste leva o canvas à área visível e exige alteração efetiva de sua transformação; no mobile usa eventos de toque CDP. Zoom: 12 acionamentos alternados dos controles, com intervalo de 180 ms. As amostras são intervalos de `requestAnimationFrame`, excluindo o primeiro frame parcial; a taxa é 1000/intervalo médio. São **frames do navegador em laboratório**, não uma medição óptica de frames apresentados na tela. A meta operacional desta suíte é ≥55 frames/s, próxima de 60. Cada gesto contém mais de 100 amostras no conjunto.

`documentNetworkMs` registra separadamente o tempo de requisição do documento. `openMs` inclui navegação, verificações e espera deliberada de estabilização de 1,2 s; não é uma métrica de carregamento puro. O benchmark não soma rede ou geração de IA à latência local. Autosave e persistência são verificados depois da edição.

O benchmark de CPU usa o código efetivo de `layoutMap` e da contagem de descendentes, executado em Node: 20 aquecimentos e 100 amostras por tamanho. Ele isola custo de algoritmo; não representa layout/paint do DOM no navegador.

## Mudanças e decisões

A contagem anterior percorria a árvore novamente para cada nó. Uma passagem em pós-ordem agora calcula todos os totais. O resultado é equivalente mesmo quando o array vem fora da ordem hierárquica, incluindo árvore de 500 nós e profundidade 30, cobertas pelo teste unitário.

O componente visual do nó foi memoizado. A seleção reaproveita os objetos e dados dos outros nós, mudando somente os dois envolvidos. As dimensões medidas continuam presentes nos objetos controlados, preservando a correção de visibilidade do ticket 23. Layout e conexões já eram memoizados e não foram alterados. A decisão segue as recomendações de [desempenho do React Flow](https://reactflow.dev/learn/advanced-use/performance).

O layout puro ficou abaixo de 1 ms no p95; não há evidência de bloqueio que justifique worker. A renderização de todos os 200/500 nós já atingiu a cadência medida; não se ativou `onlyRenderVisibleElements`, que exigiria adaptar a navegação por foco para nós fora da tela. Recolher já remove os descendentes do DOM e preserva seus dados. Não houve troca de renderer ou redução de funcionalidade.

## Resultados

Antes → depois, usando os builds de produção correspondentes e as mesmas fixtures e roteiro de entrada. Seleção/edição em ms (p95); pan/zoom em frames rAF por segundo.

| Tela, nós | Seleção p95 | Edição p95 | Pan | Zoom |
| --- | ---: | ---: | ---: | ---: |
| desktop, 200 | 34.4 → 34.6 | 15.7 → 15.0 | 60.00 → 60.00 | 60.00 → 60.09 |
| desktop, 500 | 36.4 → 35.4 | 14.1 → 15.3 | 60.00 → 60.00 | 60.14 → 60.14 |
| mobile-emulated, 200 | 35.3 → 35.1 | 16.2 → 15.6 | 60.00 → 60.00 | 60.08 → 60.06 |
| mobile-emulated, 500 | 37.7 → 37.5 | 14.8 → 15.1 | 59.63 → 60.00 | 60.00 → 60.11 |

A meta de 200 nós passou nas duas telas: seleção/edição abaixo de 100 ms no p95 e pan/zoom ≥55 frames/s. Com 500 nós, os mesmos checks funcionais passaram, sem perda de dados. A cadência antes já estava próxima de 60; não se atribui um ganho de FPS à otimização. Diferenças pequenas de latência entre rodadas não estabelecem significância estatística.

| Cálculo puro, p95 (ms) | 200 antes | 200 depois | 500 antes | 500 depois |
| --- | ---: | ---: | ---: | ---: |
| Contagem de descendentes | 0.317 | 0.040 | 2.028 | 0.049 |
| Layout D3 (sem mudança) | 0.084 | 0.145 | 0.167 | 0.222 |

A contagem em 500 nós passou de 2,028 ms para 0,049 ms no p95 (cerca de 98% menos tempo neste ensaio). O layout não foi alterado; sua pequena variação entre rodadas permanece bem abaixo do orçamento de um frame.

Os chunks do editor foram `editor-c0r5svpK.js` antes e `editor-BSZtSn1n.js` depois. Todos os JSON incluem os SHA-256 completos. As oito rodadas finais de produção (quatro antes/quatro depois) passaram. Medições exploratórias usadas para ajustar o roteiro não integram a tabela. Não houve suíte pesada concorrente durante essas rodadas finais.

As quatro combinações finais registraram três gravações de `map_user_preferences` durante a sequência completa de navegação, com debounce; nenhuma leitura/escrita de conteúdo por frame. São centenas de frames por combinação. IA não participou do benchmark. Latências de rede do documento, contagens/intervalos de frames, event timings e long tasks ficam separados nos JSON.

## Integridade e carregamento

O roteiro com Supabase real confirma, em cada tamanho/tela:

- Total de nós, ordem, pais, autoria e origem preservados após digitação; somente o texto editado muda.
- Seleção alternada por teclado mantém exatamente uma marca visual e a mesma geometria de todos os nós.
- Edição, desfazer, refazer, recarga e leitura no servidor preservam o texto final, inclusive no limite de 500 nós.
- Recolher a raiz deixa um único nó no DOM; expandir restaura exatamente 200/500 nós.
- Biblioteca não solicita `get_map_document`/`map_nodes` e não baixa o chunk do editor; este só é carregado ao entrar no mapa.
- Documento e preferências continuam usando os caminhos existentes, sem migração ou mudança de regras de autoria/permissão.

As árvores são representativas do limite, mas não cobrem toda combinação possível de profundidade, fonte, GPU ou estado térmico. O teste de equivalência da contagem inclui profundidade 30. Não há promessa de latência de IA/rede nem comprovação de desempenho em celular físico. A validação de dispositivo real pode ser repetida antes de ampliar o suporte.

## Verificação

Evidências reproduzíveis: `.scratch/mapa-mental/evidence/24/before-*.json`, `after-*.json` e capturas com os mesmos prefixos. Os JSON guardam as amostras brutas; os de CPU guardam n/p50/p95/máximo. O comando `npm run test:performance` reproduz o estado atual. Para uma comparação futura, guardar os JSON anteriores antes de rodá-lo, pois o prefixo padrão é `after`.

Checks gerais: `npm test` — 124 testes em 20 arquivos; `npm run lint` — sem erros/avisos; `npm run build` — typecheck e build aprovados; `npm run test:bundle` — fronteira pública aprovada com configuração válida e inválida. O build mantém o aviso já existente de tamanho do chunk principal e avisos de anotações do Zod, sem falha de compilação.

Limites observados em 500 nós: uma long task de 69 ms no desktop e de 84 ms no mobile emulado ao longo do roteiro completo; em 200 nós não houve long task após o aquecimento nas rodadas finais. Não há atribuição dessas tarefas ao layout puro. Event Timing máximo: 32 ms em 200 nós, 72 ms em 500/desktop e 88 ms em 500/mobile emulado. Esses valores de diagnóstico não substituem as séries de seleção/edição.

Regressão `npx playwright test --config playwright.auth.config.ts canvas.spec.ts preferences.spec.ts`: 19/20 passaram na primeira rodada. Um caso desktop de histórico com resposta perdida ficou na biblioteca durante a preparação (`openMap`, antes de solicitar o documento); o cenário não chegou a executar sua verificação de histórico. A falha original está preservada em `evidence/24/regression-initial-setup-failure.md`. O mesmo caso passou no mobile e passou duas vezes seguidas no desktop com `--grep 'history with a committed but lost response' --repeat-each=2 --project desktop`. A causa da intermitência de preparação não foi determinada; não foi ocultada por retries automáticos nem exigiu mudar a implementação do editor. Os demais casos verificaram layout/zoom, toque/pinça, exclusão, histórico, concorrência, reorganização e preferências isoladas entre contas, incluindo falhas recuperáveis.

Regressão de acessibilidade `--grep 'canvas shortcuts|touch targets'`: 7/8 passaram na primeira rodada em Chromium/WebKit desktop/mobile. Um caso WebKit desktop ficou no login antes de iniciar o cenário de foco; o registro está em `evidence/24/accessibility-initial-login-failure.md`. Esse caso passou duas vezes seguidas em reexecução isolada com `--project webkit-desktop --repeat-each=2`, sem mudança de código. Todos os cenários selecionados tiveram execução bem-sucedida; as duas intermitências de preparação permanecem registradas, com causa não determinada. As auditorias axe desses cenários aprovados não apontaram violações.

Limpeza final conferida por consulta somente de leitura no Supabase: zero usuários `mapa-validacao-…@example.com` e zero equipes `Validação …` remanescentes; `.validation-runs` vazio. Não houve deploy ou migração.
