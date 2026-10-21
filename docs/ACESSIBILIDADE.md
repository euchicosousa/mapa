# Acessibilidade — ticket 23

Os fluxos essenciais têm botões identificados, acessíveis por teclado e toque. No editor, **Ações do nó selecionado** leva ao painel sem passar pelos atalhos opcionais do canvas. **Fechar ações do nó** retorna ao mapa. O painel lateral/inferior é uma região não modal: Tab continua a navegação. Somente diálogos modais prendem o foco, permitem Escape e retornam ao controle anterior ou ao destino explicitamente indicado.

## Teclado do mapa

Os atalhos abaixo atuam somente quando o foco está no canvas ou no próprio nó, sem interceptar botões, inputs, textarea, selects ou texto editável. Campos preservam Tab, Enter e desfazer nativos. A composição de texto e modificadores não acionam operações estruturais acidentalmente. Segurar uma tecla não cria várias operações.

| Tecla | Ação no mapa |
| --- | --- |
| Espaço | Abrir as ações do nó e focar Editar texto |
| Tab | Criar filho e abrir o campo de texto |
| Enter | Criar irmão; na raiz, criar filho |
| F2 | Editar texto |
| Delete | Excluir nó; ramo com descendentes exige confirmação |
| Escape | Fechar ações e retornar ao canvas |
| Shift+Tab | Sair do canvas/nó pela ordem de foco anterior |
| Setas esquerda/direita | Ir ao pai/primeiro filho visível |
| Setas cima/baixo | Ir ao nó visível anterior/seguinte |
| Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z | Desfazer; refazer |

No campo Texto do nó, Escape conclui uma edição válida e retorna a Editar texto; um segundo Escape fecha as ações. Texto inválido continua no campo, com erro explicado e sem descarte. Os mesmos comandos estruturais têm botões, incluindo Adicionar irmão, Mover, Subir e Descer.

Os nós preservam suas medidas DOM ao atualizar seleção, evitando que React Flow os mantenha invisíveis. Um observador acompanha a remoção efetiva do elemento focado; o foco volta a um ancestral visível ou ao canvas. Fechar o painel mantém a seleção vazia mesmo quando um salvamento é confirmado depois.

## Interface e anúncios

As descrições operacionais do React Flow estão em pt-BR, inclusive a função dos atalhos e a saída por Shift+Tab. Nós expõem nome e descrição de papel “nó do mapa”. Salvamento, falhas, geração e histórico têm mensagens de estado/alerta. A visualização pessoal é anunciada ao concluir a interação, sem atualizações por frame de pan/zoom.

Foco visível usa contorno sólido; estados desabilitados têm borda tracejada e texto, sem depender de cor. Campos usam 16 px; controles de navegação e ações têm alvos de pelo menos 44×44 CSS px. Nos nós transformados pelo zoom, ações equivalentes permanecem no painel, fora da escala do canvas. Atribuição da biblioteca também tem alvo de 44 px. O nome acessível da marca contém o texto visível.

O painel inteiro pode rolar no desktop. No mobile acompanha o documento, sem cortar ações; o viewport visual é acompanhado durante a edição. Diálogos respeitam altura dinâmica e safe area. Em WebKit móvel, Concluir edição trata o fim do toque sem depender do clique sintetizado, preservando também Enter pelo teclado. `prefers-reduced-motion` desativa transições/animações autoradas e rolagem animada.

## Verificação e limites

`npm run test:a11y` usa Playwright 1.64.1, `@axe-core/playwright` 4.14.0, Chromium 156.0.8078.4 e WebKit 27.2. Os quatro projetos cobrem desktop 1440×900 e mobile 390×844. A auditoria também percorre 360, 390, 768 e 1440 px em login, biblioteca, importação e editor. Inclui modal, erro de importação, edição, movimentação, exclusão, geração real, desfazer e fechamento das ações durante salvamento.

Os testes verificam Tab/Enter em campos, desfazer nativo no campo da orientação, navegação com botões por Tab, contenção/retorno do foco nos modais, foco após exclusão/ocultação, toque, alvos 44 px e ausência de overflow de página. Altura de 420 px simula espaço reduzido de teclado virtual; viewport CSS de 720×450 testa reflow equivalente à redução da área útil de uma janela 1440×900 a 200%. Isso não representa teclado de iPhone real nem medição de zoom da interface do navegador.

Axe usa regras WCAG A/AA 2.0/2.1, sem exclusões de regras ou regiões. A inspeção manual cobre ordem de foco, nomes, estados, contraste da paleta, foco visível e conteúdo dos screenshots. Contrastes calculados: tinta/papel 17,95:1; texto secundário/papel 5,50:1 e sobre superfície 5,04:1; borda funcional/papel 3,78:1 e sobre superfície 3,47:1. Divisores decorativos não são usados como única identificação de controle. Avisos inconclusivos de contraste foram confrontados com esses tokens; os ícones +/− têm nomes de ação explícitos. Guards e conteúdo oculto pelo Radix durante modais foram conferidos pela contenção real de foco, incluindo Tab repetido e Escape. A suíte completa passou 16/16, com 72 varreduras sem violações; a revisão final dos grupos semânticos e do painel de tablet passou mais 8/8, com 60 varreduras sem violações. Resultados e imagens ficam em `.scratch/mapa-mental/evidence/23`.

Amostra assistida no Mac físico com macOS 26.6.2 (25G83), Chrome for Testing e VoiceOver, voz Luciana em português (Brasil). O usuário desbloqueou o Mac e confirmou a ativação e início de fala por Fn+Command+F5. Depois foi executado selecionar → editar → gerar quatro filhos reais → desfazer o lote, voltando de nove para cinco nós. Nomes/valores, autoria, estado de salvamento, andamento/conclusão da geração e resultado do desfazer foram conferidos na árvore AX nativa e no app. Há registro específico em `evidence/23/voiceover`. VoiceOver foi desligado ao encerrar a amostra.

O agente não grava nem escuta a saída de áudio do sistema; a ativação audível foi confirmada pelo usuário. Pronúncia e todos os anúncios não tiveram avaliação auditiva independente. Não houve amostra com linha braille, VoiceOver de iPhone, TalkBack ou teclado virtual em aparelho móvel físico. WebKit/Chromium mobile são emulação, não certificação de Safari em hardware. A varredura automática e esta amostra não certificam conformidade integral em todas as tecnologias assistivas.

## Repetir a amostra nativa

Iniciar o frontend na porta 4176 e executar `node scripts/validation-accessibility.mjs`. O script verifica o projeto final, cria identidades/mapas temporários e abre uma janela de testes já autenticada. Não imprime nem persiste credenciais. Ao terminar, pressionar Enter no processo fecha o navegador e remove somente os IDs da execução; registros em `.validation-runs` permitem limpeza exata se houver interrupção. Usar o teclado físico para ativar o leitor quando necessário e restaurar sua configuração ao terminar. Não usar contas ou mapas da equipe para testes destrutivos.

Referências consultadas: [acessibilidade do React Flow](https://reactflow.dev/learn/advanced-use/accessibility), [teste de acessibilidade com Playwright e axe](https://playwright.dev/docs/accessibility-testing), [comandos do VoiceOver](https://support.apple.com/guide/voiceover/general-commands-cpvokys01/10/mac/27).
