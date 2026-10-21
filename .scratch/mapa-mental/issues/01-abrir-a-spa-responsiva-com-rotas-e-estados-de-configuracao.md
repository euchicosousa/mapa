# 01: Abrir a SPA responsiva com rotas e estados de configuração

**What to build:** Abrir o app em computador ou celular, navegar por URLs e identificar quando falta configuração sem mostrar telas quebradas.

**Blocked by:** Nenhum (pode iniciar imediatamente).

**Status:** done — revisão Swiss Design concluída e verificada; histórico original preservado.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Inicializar React/TypeScript/Vite com npm, versões exatas e lockfile; instalar as dependências do contrato e registrar runtime. Configurar Router Data Mode, Query e estado local sem duplicar responsabilidades.
2. Criar shell Swiss Design com escala neutra entre #fafafa e #121212 e rotas do contrato, com destinos ainda não implementados identificados como indisponíveis nesta etapa. Criar carregamento e erro de rota; editor carregado sob demanda.
3. Validar URL/chave publicável do Supabase na inicialização; exibir instrução de configuração sem imprimir valores. Criar exemplo de variáveis sem segredos.
4. Disponibilizar scripts de desenvolvimento, build, typecheck, lint, testes unitários e navegador; um smoke real de navegação. Criar README de execução local.

## Ajuste solicitado após a entrega — concluído

A base funcional deste ticket já foi implementada. Retomar somente o ajuste visual e sua verificação; preservar rotas, validação de configuração, dependências e acessibilidade existentes. Não reinicializar o projeto.

1. Ler a seção “Direção visual obrigatória — Swiss Design” do contrato técnico. Ela substitui o tema anterior.
2. Trocar a paleta existente pelos tokens neutros do contrato: papel #fafafa, tinta #121212 e cinzas intermediários para superfícies, bordas e texto secundário. Remover verdes, branco puro e sombras. Conferir contraste dos estados interativos; centralizar a escala em tokens.
3. Ajustar o shell para grid editorial, hierarquia tipográfica sem serifa, alinhamento à esquerda, bordas retas e respiro. Remover a marca serifada e cartões arredondados da primeira implementação.
4. Cantos retos se aplicam aos controles e painéis da interface, não obrigam o formato dos nós. Pílulas e personalização de formatos ficam para discussão posterior; não criar seletor agora. Aplicar a direção a todas as telas/estados já entregues, com foco, seleção e avisos monocromáticos. Cores semânticas e cores de mapas não entram agora.
5. Verificar desktop/mobile, atualizar screenshots e rodar os checks existentes pertinentes. Acrescentar registro desta revisão sem apagar o histórico da entrega original.

### Critérios adicionais da revisão Swiss — verificados

- [x] Estilo Swiss perceptível na composição, tipografia, alinhamentos e separação por linhas/espaçamento; não apenas troca de cores.
- [x] Todos os estilos autorados usam a escala neutra entre #fafafa e #121212, com cinzas intermediários centralizados; texto, controles e foco mantêm contraste. Não há cor de destaque nem paleta colorida semântica/de mapas.
- [x] Painéis, botões e campos têm cantos retos, sem sombra/gradiente; tipografia de interface sem serifa.
- [x] Login, aviso de configuração, 404, erro, loading, navegação ativa e foco seguem a mesma direção.
- [x] Capturas novas em 1440×900 e 390×844; inspeção em 360 px sem overflow ou perda de alvos de toque.
- [x] Build, typecheck, lint e smoke de navegação existentes continuam passando; testes de CSS puramente espelhados à implementação não são necessários.

## Critérios de aceite da entrega original (histórico)

- [x] Abrir /login e uma URL desconhecida mostra telas distintas; voltar/avançar funciona.
- [x] Shell cabe em 390×844 e 1440×900 sem rolagem horizontal da página.
- [x] Configuração ausente não causa tela branca; nenhum segredo aparece no bundle.
- [x] Build, tipos e smoke de navegação passam com comandos documentados.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Navegar diretamente nas rotas e no 404; rodar build/typecheck e smoke nos dois tamanhos.

## Limites desta entrega

Entrega é o shell verificável. Não criar login falso, mapas fictícios persistentes ou integração IA.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor — 19 de outubro de 2026

**Status da entrega original: done, antes do ajuste Swiss.** Este registro histórico não encerra a revisão visual pendente. Nenhum bloqueador na entrega original; execução limitada ao ticket 01. Ticket 02 não iniciado.

### Comportamento entregue

- SPA React/TypeScript strict/Vite em pt-BR, com npm e dependências exatas/lockfile. Node v22.17.0 e npm 10.9.2. Versões completas registradas no README da raiz e em package.json/package-lock.json.
- React Router Data Mode: todas as rotas do contrato, 404 própria, voltar/avançar, fallback inicial, indicação de navegação e fronteira recuperável de erro sem renderizar detalhes brutos. Editor em chunk lazy separado.
- Shell com navegação completa no desktop e compacta abaixo de 768 px, foco visível, link para pular ao conteúdo, foco sem deslocamento da página, safe areas e altura dinâmica. Alvos principais de pelo menos 44 px. Nenhum formulário antecipado.
- QueryClient configurado para dados remotos; store Zustand reservado ao editor, sem documento ou persistência fictícia. Sem duplicação de sessão/dados.
- Validação Zod da URL raiz e chave publicável Supabase na inicialização via configuração Vite. Compatibilidade com anon JWT local; chaves privilegiadas e URLs inseguras são recusadas. Somente campos públicos validados podem entrar no bundle, sem exposição automática de VITE_*. Avisos exibem nomes dos campos, nunca os valores.
- .env.example sem segredos e README com execução/configuração/checks/limites. Rotas de login, senha, equipe, biblioteca e editor informam a indisponibilidade desta etapa; nenhuma integração foi simulada.

### Verificações e resultados finais

| Comando | Resultado |
| --- | --- |
| `node --version` / `npm --version` | v22.17.0 / 10.9.2 |
| `npm install --save-exact …` / `npm install -D --save-exact …` | Dependências do contrato e ferramentas instaladas; lockfile gerado. npm reportou zero vulnerabilidades. |
| `npm view … engines/peerDependencies` | Compatibilidade de Node/Vite/ESLint/TypeScript verificada; ESLint final 10.13.0 e tipos Node 22.20.5. |
| `npm ls --depth=0` | Árvore instalada consistente, sem dependências inválidas. |
| `npm run typecheck` | Passou; também executado pelo build final. |
| `npm run lint` | Passou, zero avisos. |
| `npm test` | 6 testes passaram em 2 arquivos: configuração e erro de rota. |
| `npm run test:bundle` | Passou em dois builds temporários: configuração inválida e pública válida. Marcadores sintéticos de chave privilegiada e variável VITE privada não apareceram nos bundles. Estado de configuração correto; sem acesso externo. |
| `npm run build` | Passou; JS principal 346,87 kB (110,07 kB gzip); editor lazy 0,27 kB. |
| `npx playwright install chromium` | Chromium instalado e executado. |
| `npm run test:e2e` | 8/8 passaram após ajuste final: quatro cenários em cada viewport. Build de produção servido localmente, sem mocks de navegação. |
| `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` | Servidor local iniciou; prévia solicitada no painel do Codex e capturas inspecionadas visualmente. |

Navegador: Chromium desktop **1440×900** e emulação mobile com toque **390×844**. Verificados acesso inicial, todas as nove rotas explícitas, raiz e rota desconhecida, recarga por URL, histórico, tela de configuração expandida, lazy/loading, ausência de erro JavaScript no fluxo de navegação e ausência de overflow horizontal. Ajuste de foco confirmado com scrollY=0 na abertura. Emulação não substitui aparelho físico/Safari; isso não é alegado como teste executado.

Capturas revisadas e preservadas:

- [Desktop](../evidence/01/desktop-login.png) e [configuração expandida](../evidence/01/desktop-login-config.png).
- [Mobile](../evidence/01/mobile-login.png) e [configuração expandida](../evidence/01/mobile-login-config.png).
- Relatório reexecutável: `playwright-report/index.html` (artefato local ignorado). Cenários em `tests/e2e/navigation.spec.ts`; instruções no README da raiz.

As primeiras tentativas de download/servidor encontraram as restrições locais de rede e abertura de porta. Downloads e testes foram concluídos com a liberação do ambiente. Nenhum bloqueio de infraestrutura permanece para esta fatia. A validação inicial de URL vazia foi corrigida e coberta por teste; os resultados finais acima são posteriores à correção.

### Configuração externa, escopo e retomada

Nenhuma configuração externa é necessária para concluir este ticket. URL/chave reais não foram fornecidas: o app mostra precisamente a necessidade de VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY em .env.local, sem tela branca. Validação de formato não comprova conectividade. Não houve chamadas Auth/banco/IA, migrações, seeds, conta fictícia, cobrança ou deploy.

O redirecionamento de `/` vai a `/login` nesta base; a decisão conforme sessão real e o retorno interno validado pertencem à autenticação do ticket 02. Nenhum conteúdo privado é carregado durante esta etapa. CLI Supabase/containers e banco local não foram exercitados porque não há integração de banco/Auth nesta fatia; deverão estar disponíveis para executar/verificar o ticket 02.

Próximo ticket desbloqueado: **02**, dependência 01 concluída. Aguardar revisão do usuário antes de iniciar outra fatia, conforme a instrução desta execução.


## Revisão Swiss Design — 19 de outubro de 2026

**Status final: done.** Retomada limitada ao ajuste visual aprovado do ticket 01. A especificação foi alterada no contrato, guia de execução, plano e ticket após a entrega original; o código encontrado ainda usava verde, marca serifada, cartões arredondados e sombras. A revisão aplica o contrato atualizado à implementação existente.

### Alterações realizadas

- `src/styles.css`: escala acromática centralizada em tokens (#fafafa, #f0f0f0, #e6e6e6, #d4d4d4, #808080, #666666, #121212). Tokens semânticos de fundo, superfície, texto, borda, ação e foco referenciam essa escala. Seleção de texto, accent-color, hover, estado ativo e foco também são monocromáticos. Removidos verdes, branco puro, sombras, arredondamentos e fonte serifada.
- Grid editorial com 12 colunas no desktop e 4 abaixo de 768 px. Cabeçalho, conteúdo e rodapé compartilham margens e trilhas; rótulo na coluna esquerda e título/conteúdo deslocados no desktop. Margens de 48 px no desktop, 24 px no mobile e 16 px em 360 px. Espaçamentos em múltiplos de 8 px.
- Helvetica Neue/Helvetica/Arial, sem download, pesos 400/700, corpo 16 px, títulos de 32 a 64 px, entrelinha compacta nos títulos e 1,5 no texto de leitura. Wordmark “Mapa.” sem símbolo serifado. Painéis abertos delimitados por linhas, em vez de cartões arredondados.
- `src/app/shell.tsx`, `src/routes/pages.tsx` e `index.html`: marca sem serifa, painéis de acesso e theme-color neutro. Rotas, conteúdo, configuração, dependências, autenticação e estado mantidos; nenhuma integração nova ou simulada. Nós e personalização de formatos não foram implementados.
- Estilos comuns cobrem login, aviso de configuração, loading, erro, 404 e indisponibilidade. Foco de controles com contorno de 2 px/offset de 4 px; destino main continua recebendo foco de navegação sem contorno do tamanho da página. `disabled`/`aria-disabled` têm estilo contextual monocromático sem opacity (nenhum controle desabilitado foi adicionado).
- Smoke ampliado de 8 para 15 execuções: 5 cenários em 1440×900, 390×844 e 360×800. Inclui falha real de carregamento do chunk, recuperação, foco por Tab e medidas mínimas de 44×44 nos links principais e summary. A falha do chunk é induzida somente no teste por bloqueio da requisição; produto não contém simulação.

### Verificação

| Comando/verificação | Resultado |
| --- | --- |
| `npm run lint` | Passou sem avisos. |
| `npm run typecheck` | Passou; repetido no build final. |
| `npm run build` | Passou; CSS 10,01 kB (3,01 kB gzip), JS principal 346,85 kB (110,06 kB gzip), editor lazy 0,27 kB. |
| `npm test` | 6/6 passaram, sem alteração de domínio. |
| `npm run test:bundle` | Ambos os cenários passaram; fronteira pública preservada. |
| `npm run test:e2e` | 15/15 passaram após o ajuste final. Sem overflow horizontal, inclusive com aviso expandido em 360 px. |
| Busca de cores/estilos autorados em src e index.html | Somente os sete tons centrais e theme-color #fafafa; sem inline colors, sombras, gradientes ou overrides coloridos de bibliotecas. |
| Inspeção visual das capturas | Login, configuração expandida, navegação ativa/foco por teclado, 404, erro e loading seguem a mesma direção. Comparação com as capturas originais; evidências anteriores preservadas. |

Contrastes calculados pela luminância relativa sRGB: tinta/papel **17,95:1**; secundário/papel **5,50:1**; secundário/superfície **5,04:1**; borda funcional/papel **3,78:1** e borda funcional/superfície **3,47:1**; tinta/hover **15,01:1**. Divisor #d4d4d4 é decorativo; limites/foco de controles usam tinta ou borda funcional. Não houve testes de CSS que apenas espelham os tokens.

### Evidências novas

Capturas completas em [evidence/01/swiss](../evidence/01/swiss), com seis estados por viewport:

- [Login desktop](../evidence/01/swiss/desktop-login.png), [aviso expandido](../evidence/01/swiss/desktop-login-config.png), [foco](../evidence/01/swiss/desktop-focus-navigation.png), [404](../evidence/01/swiss/desktop-404.png), [erro](../evidence/01/swiss/desktop-route-error.png) e [loading](../evidence/01/swiss/desktop-loading.png).
- [Login mobile 390 px](../evidence/01/swiss/mobile-login.png) e [aviso expandido](../evidence/01/swiss/mobile-login-config.png).
- [Login mobile 360 px](../evidence/01/swiss/mobile-360-login.png) e [foco/aviso expandido](../evidence/01/swiss/mobile-360-focus-navigation.png).

Limites: Chromium com emulação mobile, sem alegar validação em Safari/aparelho físico. Nenhum banco, migração, gasto, deploy ou integração externa nesta revisão. Sem configuração externa necessária. Não há repositório Git no diretório; comparação baseada no histórico desta execução, código e evidências originais, sem diff de commits.

Ticket e manifesto sincronizados em done. Ticket 02 volta a estar desbloqueado por dependência, mas permanece ready-for-agent e não foi iniciado nesta execução.


### Continuidade — marca MAPA e início de 02

Por solicitação posterior do usuário, criada e salva a marca **MA / PA** em `public/brand/mapa.svg` e versão inversa, inspirada na composição do logo CNVT de cnvt.com.br. Aplicada no cabeçalho/favicon, sem mudar a direção Swiss. Evidências atuais em `../evidence/02`. Ticket 01 permanece done; seu histórico e screenshots anteriores foram preservados. Ticket 02 foi iniciado e registrado blocked por infraestrutura local; ver seu registro para retomar.
