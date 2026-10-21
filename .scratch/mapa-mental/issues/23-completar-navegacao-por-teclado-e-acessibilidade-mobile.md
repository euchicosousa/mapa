# 23: Completar navegação por teclado e acessibilidade mobile

**What to build:** Todos os fluxos essenciais funcionam por teclado e toque, com foco e mensagens acessíveis.

**Blocked by:** 11: Mover ramos e ordenar irmãos por controles acessíveis; 12: Recolher ramos e lembrar a visualização por pessoa; 13: Organizar a biblioteca por projeto e responsável; 19: Importar backup como mapa novo e validado; 22: Limitar uso de IA e expor falhas recuperáveis

**Status:** done — concluído em 20/10/2026; critérios verificados em Chromium/WebKit, teclado/toque e amostra assistida de VoiceOver.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Aplicar atalhos e escopo definidos no contrato; preservar undo/Tab/Enter nativos em campos. Todas as ações têm botões identificados.
2. Auditar login, biblioteca, editor, importação e geração em 360/390/768/1440 px. Corrigir sobreposição, safe areas, teclado virtual, foco em modais e fechamento do painel.
3. Configurar labels/localização do React Flow e anunciar salvamento, erro e geração sem anunciar cada frame. Contraste WCAG AA, foco visível, reduced motion e targets 44 px.
4. Testar leitor de tela por amostragem do fluxo selecionar nó→editar→gerar→desfazer; documentar ambiente e limites. Corrigir comportamento no componente de origem, não criar versão mobile duplicada.

## Critérios de aceite

- [x] Criar, editar, mover, excluir e gerar podem ser feitos sem mouse e sem atalhos obrigatórios.
- [x] Tab em campo move foco normalmente; atalhos do canvas não interceptam texto.
- [x] Painéis prendem/restauram foco corretamente; nó excluído/oculto não retém foco.
- [x] Sem rolagem horizontal de página nem controles inacessíveis em 360 px.
- [x] Erros automatizados graves de acessibilidade são corrigidos e inspeção manual registrada.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Playwright com teclado/toque e axe; inspeção em WebKit/Chromium e aparelho real disponível. Diferenciar emulação de validação em hardware.

## Limites desta entrega

Mobile já é requisito dos tickets anteriores; esta fatia fecha lacunas, não adia adaptação inteira para o fim.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Implementação em 20/10/2026 no frontend existente; sem migração de banco, alteração de autorização ou cópia do ambiente. Integrações continuam no projeto final `mapa` (`bodxafqkqlyfoyfgahyj`). Skill aplicada: revisão de acessibilidade WCAG 2.1 AA.

Entregue:

- Atalhos restritos ao canvas/nó, incluindo Tab, Enter, F2, Delete, Escape e desfazer/refazer; setas navegam por nós visíveis. Campos, botões e composição de texto preservam suas teclas nativas. Shift+Tab permite sair do canvas. Todos os comandos essenciais têm botões, incluindo novo Adicionar irmão e entrada direta nas ações do nó.
- Instruções e papéis do mapa em pt-BR. Nome acessível da marca contém seu texto visível. Grupos de histórico, navegação do mapa e visualização pessoal têm papel semântico. Estados de salvar, erro, gerar e desfazer permanecem anunciáveis, sem mensagens por frame de pan/zoom.
- Preservação das medidas dos nós controlados evita nós invisíveis ao trocar seleção. Foco após exclusão/ocultação retorna a destino visível. Diálogos guardam/restauram foco; painel não modal não prende Tab. Fechar as ações continua válido após confirmação assíncrona de salvamento, com teste de regressão específico.
- Painel rola por inteiro no desktop e segue o documento no mobile; tablet tem largura suficiente para rótulos completos. Concluir edição trata toque de WebKit sem depender de clique sintetizado. Bordas, foco, safe areas, campos 16 px, reduced motion e alvos 44 px preservados. Texto dos botões também é conferido contra sua própria caixa.

Verificações concluídas:

- `npm test`: 123/123; inclui painel fechado durante confirmação assíncrona. `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:bundle`: aprovados. Avisos de bundle/dependências preexistentes não bloqueiam build.
- `npm run test:a11y`: 16/16, Chromium 156.0.8078.4 e WebKit 27.2, desktop 1440×900 e mobile 390×844. 72 varreduras axe WCAG A/AA 2.0/2.1, zero violações; sem exclusão de regras ou regiões. Inclui 360/390/768/1440 px, campos nativos, foco de modais, ramo oculto/excluído, IA real e desfazer, toque e altura de 420 px.
- `npm run test:e2e:auth -- canvas.spec.ts preferences.spec.ts import.spec.ts`: 26/26. Regressão de 50 nós, medições, pan/pinch, histórico, mover/ordenar, importação válida/inválida/idempotente e preferências entre contas, com dados reais descartáveis.
- `npm run test:e2e`: 15/15, navegação pública, foco, rotas sem configuração e ausência de overflow.
- Revisão manual de screenshots, conteúdo dos nomes, foco e paleta. Contrastes: tinta/papel 17,95:1; texto secundário 5,50:1 ou 5,04:1; bordas funcionais 3,78:1 ou 3,47:1. Achados inconclusivos axe sobre contraste/ícones e guards Radix foram confrontados com tokens, nomes de ação e contenção real de foco. Papéis dos grupos foram corrigidos na origem.
- Amostra assistida no Mac físico com macOS 26.6.2, Chrome for Testing e VoiceOver (Luciana, pt-BR). O usuário desbloqueou o Mac e confirmou início de fala após ativação física por Fn+Command+F5. A sequência selecionar → editar → gerar lote real → desfazer foi executada; o mapa voltou de nove para cinco nós. Rótulos, valores, mensagens e estado foram conferidos pela árvore AX nativa e pelo app. VoiceOver foi desligado ao terminar.

Evidências: `../evidence/23/{chromium-desktop,chromium-mobile,webkit-desktop,webkit-mobile}`, `axe-results.json`, `contrast.json` e `voiceover`. Guia de uso, repetição da amostra e limites em `docs/ACESSIBILIDADE.md`.

Limites declarados: mobile emulado em Chromium/WebKit, sem iPhone/Android físico, TalkBack ou linha braille. Altura reduzida simula área do teclado; viewport 720×450 verifica reflow equivalente à área útil de 200%, sem afirmar zoom nativo do navegador. O agente não grava/escuta áudio do sistema: ativação audível foi confirmada pelo usuário, mas pronúncia e todos os anúncios não receberam avaliação auditiva independente. A amostra não certifica conformidade integral em todas as tecnologias assistivas.


Revisão final: após ampliar o painel em 768–1023 px e atribuir papéis aos grupos nomeados, `npm run test:a11y -- -g 'audit login|touch targets'` passou 8/8, com mais 60 varreduras e zero violações. A revisão passou a conferir também o texto dos botões dentro de sua própria caixa. Evidências atualizadas em `axe-followup.json` e screenshots; os nomes de grupos não geram mais achados inconclusivos de atributo ARIA proibido.

Limpeza final confirmada no projeto: zero contas/workspaces temporários, zero liberações temporárias de IA, `.validation-runs` vazio. Navegador de amostra e servidor próprio encerrados; leitor temporário desligado. **Status final: done.** Ticket 24 é o próximo da sequência; nenhum outro foi iniciado.
