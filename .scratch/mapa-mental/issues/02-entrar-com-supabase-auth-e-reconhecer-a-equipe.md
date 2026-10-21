# 02: Entrar com Supabase Auth e reconhecer a equipe

**What to build:** Uma conta existente entra com e-mail/senha, vê sua equipe e sai; contas sem equipe não veem mapas.

**Blocked by:** 01: Abrir a SPA responsiva com rotas e estados de configuração

**Status:** done — verificado no projeto final `mapa` (`bodxafqkqlyfoyfgahyj`): test:rls 7/7 e test:e2e:auth 14/14 (desktop 1440×900 e mobile 390×844), contas temporárias removidas.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Identificar e inspecionar o projeto Supabase final. Aplicar migrações versionadas de perfis, espaços e vínculos, RLS e helpers sem reset ou seed local. Configurar Auth no projeto hospedado e criar primeiro administrador/equipe real. Gerar tipos do schema remoto.
2. Implementar login real, sessão inicial, renovação e logout. Cadastro público fica desativado. Perfil vem de trigger segura na criação Auth; nome é apenas apresentação, nunca autorização.
3. Criar layout autenticado e /sem-acesso. Consultar vínculo ativo no servidor; retorno interno após login deve ser validado. Uma conta sem vínculo não recebe dados.
4. Limpar cache e estado ao trocar/sair da conta. Documentar procedimento administrativo para criar o primeiro admin, sem endpoint público.

## Retomada obrigatória — projeto final único

A decisão posterior do usuário substitui o bloqueio por Docker. Preservar a implementação Auth existente e adaptar as ferramentas já criadas:

1. Substituir obtenção de URL/chaves pelo stack local por configuração explícita do projeto final. O frontend roda localmente usando esse mesmo backend.
2. Adaptar geração de tipos para projeto remoto; consultar CLI --help e usar conexão/conector remoto sem container. Validar destino e preservar tipos anteriores se geração falhar.
3. Substituir fixtures/suites dependentes de loopback por integração delimitada do contrato. Não remover guardas do seed local para executá-lo no remoto. Criar contas de validação seguras somente quando necessárias e registrar recursos por run_id.
4. Retirar seed:local/local:configure do fluxo recomendado; adaptar scripts e testes de Auth/RLS, package.json e documentação. Não considerar os scripts atuais já compatíveis com remoto sem verificar.
5. Validar migração/histórico e permissões no projeto final, sem reset limpo. Os cenários A/B/C/D continuam como matriz de permissões; nunca revogar ou alterar senha de colega real para executar essa matriz.

É possível iniciar a adaptação agora. Se faltar referência/URL ou acesso administrativo, registrar precisamente a entrada faltante; não pedir Docker nem criar outro banco.

## Critérios de aceite

- [x] A e B acessam equipe X; C pertence apenas a Y; D vê sem acesso.
- [x] Senha errada mantém formulário com erro compreensível; recarregar mantém sessão válida.
- [x] Logout impede acesso pela navegação voltar e elimina dados da conta anterior.
- [x] Anon, D e C não leem membros/perfis privados de X via API; user_metadata não concede papel.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Login Playwright com identidades autorizadas no projeto final e testes delimitados de RLS com tokens distintos; verificar migrações aplicadas e schema do projeto final sem reset.

## Limites desta entrega

Não incluir OAuth, self-signup ou múltiplas equipes na interface.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro histórico do executor — anterior à decisão de banco único

**Status histórico: blocked por infraestrutura local; superado pela decisão de usar o projeto final.** Ticket 01 estava done e o usuário autorizou iniciar 02 depois da criação da marca. Nenhum ticket posterior foi iniciado.

### Marca entregue antes de iniciar 02

Consultado https://cnvt.com.br e o componente vetorial público `/assets/Logo-B51Y_m-M.js`. A marca CNVT usa bloco quase quadrado de duas linhas, sans geométrica pesada e viewBox 622×613. Criada adaptação original **MA / PA** com paths, sem fonte externa e fundo transparente:

- `public/brand/mapa.svg` (#121212) e `public/brand/mapa-inverso.svg` (#fafafa), com título/descrição acessíveis.
- Notas em `public/brand/README.md`. Aplicada ao cabeçalho e favicon; SVG renderizado e inspecionado visualmente.
- [Prévia do desenho](../evidence/02/mapa-logo-preview.png), [desktop com marca](../evidence/02/desktop-login.png) e [mobile com marca](../evidence/02/mobile-login.png).

### Código preparado nesta fatia

- CLI Supabase **2.121.0** adicionada com versão exata e lockfile; init e migration new pela CLI. Config local expõe só public, bloqueia signup e acesso anônimo, usa URLs locais. Sem vínculo com projeto remoto.
- Migração **20261019122810_identity_and_workspaces.sql** cria profiles/workspaces/workspace_members, índices e integridade, RLS e grants somente SELECT para authenticated. Anon não lê; clientes não escrevem membros/papéis. Helpers privados SECURITY DEFINER usam auth.uid(), search_path vazio, nomes qualificados e EXECUTE restrito para evitar recursão das políticas. Trigger de Auth cria apenas perfil de apresentação; metadata não autoriza. Perfis de colegas inativos permanecem identificáveis para membros ativos.
- Seed SQL com equipes fictícias; script de seed local usa Auth Admin API real para A/B/C/D e vínculo administrativo real. Não há resposta simulada no produto; script recusa destino não local. **Seed não executado por falta do stack.**
- Cliente SDK real com sessão persistida, auto refresh, getUser para identidade verificada e consulta de vínculo ativo. Login/sair com Router actions; rotas privadas com loaders, tela sem vínculo, equipe consultada por API e destino interno validado. Biblioteca/editor seguem indisponíveis até suas fatias.
- QueryClient guarda dados remotos; transições de sessão cancelam/limpam caches e resetam Zustand. Barreira visual durante revalidação; eventos Auth, foco/retorno à aba e restauração bfcache revalidam. Cadastro público/OAuth não foram adicionados. Recuperação de senha continua no ticket 03.
- Script administrativo idempotente para primeiro admin, sem endpoint público e sem credencial no bundle; procedimento documentado, não executado em produção.
- `src/lib/database.types.ts` é contrato **provisório manual**, identificado no arquivo. `npm run db:types` gera do banco e só substitui em caso de sucesso. Não alegar tipos gerados nesta execução.

### Verificações executadas

| Verificação | Resultado |
| --- | --- |
| Consulta ao changelog/docs Supabase, API getUser/onAuthStateChange/signOut/passwords e CLI help | Executada antes da implementação. APIs compatíveis com SDK 2.118.0; CLI 2.121.0. |
| `npm install -D --save-exact supabase` | Passou; npm reportou zero vulnerabilidades. |
| `npx supabase init` / `npx supabase migration new identity_and_workspaces` | Config e arquivo de migração criados pela CLI. Sem diff/pull disponível porque não há banco local em execução. |
| `npx supabase start` | Falhou: `DockerLifecycleInspectError` — `docker: command not found (podman also not found) — install Docker Desktop or Podman and ensure it is on PATH`. |
| `npm run typecheck` | Passou (também no build final). Não valida o contrato provisório contra banco inexistente. |
| `npm run lint` | Passou, zero avisos. |
| `npm test` | 10/10 passaram: configuração, erro de rota, retorno seguro e limpeza de cache/estado com barreira por geração. Não são testes de integração Auth/RLS. |
| `npm run build` | Passou. Bundle principal 433,20 kB (135,50 kB gzip), CSS 13,91 kB (3,83 kB gzip), editor lazy 0,25 kB. Avisos de comentários PURE do Zod removidos pelo Rollup; build concluído. |
| `npm run test:bundle` | Passou: somente configuração pública permitida, sem marcadores de chave privilegiada ou VITE arbitrária. |
| `npm run test:e2e` | **15/15 passaram** no build sem configuração, em 1440×900, 390×844 e 360×800: navegação/404/histórico, configuração ausente, foco/toque, SVG servido/renderizado e rotas privadas sem vazamento de conteúdo. Não comprova login autenticado. |
| `npm run test:rls` | Falhou na preparação: Supabase local indisponível. Asserções contra banco não executadas. |
| `npm run test:e2e:auth` | Falhou antes dos cenários: exige Supabase local real e .env.local público válido. Nenhum login real foi executado. |
| `npm run db:types` | Falhou com mensagem controlada e preservou o contrato provisório. |

Capturas novas e inspecionadas em [evidence/02](../evidence/02). Evidências do ticket 01 (inclusive revisão Swiss) preservadas. Chromium com emulação de toque; sem validação em Safari/aparelho físico. O formulário configurado, equipe e logout reais ainda precisam da verificação desktop/mobile com o stack ativo.

### Retomada vigente

Seguir docs/AUTH-SUPABASE.md e a seção de retomada acima. O fluxo antigo com Supabase local/reset/seeds deixou de ser requisito. O código e testes preparados ainda precisam da adaptação para remoto e da verificação real. Os resultados históricos acima não comprovam integração com o projeto final.

Ticket 02 e manifesto agora estão ready-for-agent para essa adaptação; seus dependentes continuam aguardando done. Nenhum banco remoto foi alterado por esta revisão do planejamento.


## Execução no projeto final — 19 de outubro de 2026

**Status: done** (ver "Validação real" ao final).

### Projeto e banco
- O único projeto da conta conectada era `uzzina`, com schema e usuários de outro produto. Com aprovação do usuário, criado o projeto dedicado **mapa** (`bodxafqkqlyfoyfgahyj`, sa-east-1, org agenciacnvt, custo informado US$ 0/mês). `uzzina` não foi alterado.
- Migração aplicada pelo conector como `20261019140900_identity_and_workspaces`; arquivo local renomeado para essa versão. Sem reset ou seed.
- Conferido no banco: anon sem grants; authenticated só SELECT nas três tabelas; helpers executáveis só por authenticated; função do trigger sem EXECUTE para anon/authenticated; três políticas SELECT. Advisors de segurança: nenhum alerta.
- Auth configurado pelo usuário no painel (signup público e anônimo desativados, Site URL/redirects locais).
- Primeiro admin criado pelo usuário com `npm run bootstrap:admin`; conferido: 1 conta confirmada, equipe CNVT, papel admin ativo.

### Código
- `src/lib/database.types.ts` gerado do projeto. `role`/`status` são texto com check, então `src/auth/access.ts` passou a validar o papel em tempo de execução (valor desconhecido → indisponível).
- `scripts/validation-run.mjs`: run_id, espaços X/Y e contas A/B/C/D temporárias com senhas aleatórias em memória, registro só de IDs em `.validation-runs/`, limpeza por IDs exatos (vínculos → perfis → espaços → contas, por causa de `on delete restrict`), conferência do project ref antes de criar recursos; `npm run validation:cleanup` para execuções interrompidas.
- `tests/integration/rls.test.mjs` e `tests/auth/login.spec.ts` + `global-setup.ts` reescritos sobre essas contas; teste de signup registra para limpeza uma conta eventualmente criada; novos casos: anon não lê nenhuma tabela, D não insere vínculo.
- `playwright.auth.config.ts` sem pressuposto de loopback. `npm run db:types` usa `--project-id` e grava via arquivo temporário.
- Smoke público passa a gerar build próprio sem configuração em `dist-smoke` (antes falhava em máquina com `.env.local`).
- Fluxo local movido para `../legacy-local/`; `seed:local`/`local:configure` removidos do package.json; seed desativado em config.toml.

### Verificações
| Verificação | Resultado |
| --- | --- |
| `tsc --noEmit` | Passou. |
| `eslint . --max-warnings 0` | Passou. |
| `vitest run` | 10/10. |
| `npm run build` / `npm run test:bundle` | Passaram. |
| `npx playwright test` (smoke público) | 15/15 após isolar o build sem configuração (3 falhas antes da correção). |
| `npm run test:rls` sem variáveis | Recusa antes de criar recursos, como esperado. |
| `npm run test:rls` / `npm run test:e2e:auth` no projeto | Executados pelo usuário no próprio terminal; ver "Validação real". |

### Validação real

Executadas pelo usuário no terminal, com `MAPA_PROJECT_REF` e a chave secreta só no ambiente:

| Suíte | Resultado |
| --- | --- |
| `npm run test:rls` | **7/7**: escopo A/B→X, C→Y, D sem vínculo; anon não lê nenhuma tabela (401); anon/C/D não leem membros/perfis de X; metadata não concede papel; escrita direta e auto-inserção negadas (403); desativação revoga leitura na hora e preserva identidade histórica; signup público recusado (400); refresh mantém identidade e escopo. |
| `npm run test:e2e:auth` | **14/14** em desktop 1440×900 e mobile 390×844: login real das quatro contas, recarregar mantém sessão, D vai a /sem-acesso, senha errada mantém e-mail e explica erro, `next` externo não sai do app, logout + voltar não mostra dados e limpa `mapa.auth.v1`, troca A→C no mesmo navegador sem resíduo da equipe anterior. |

- Primeira tentativa do e2e falhou ao carregar supabase-js sob os hooks de módulo do Playwright (Node 22.17, `ERR_INTERNAL_ASSERTION`, ciclo `webauthn`↔`webauthn.errors` em auth-js CJS). Corrigido: `tests/auth/global-setup.mjs` cria e limpa a execução num processo Node filho (`validation-run.mjs create|cleanup`); credenciais trafegam só pelo pipe e pelo ambiente.
- Limpeza conferida no banco após as duas suítes: 1 conta, 1 perfil, 1 vínculo, só a equipe CNVT; nenhuma conta `mapa-validacao-*`; `.validation-runs/` vazio. Logs do projeto mostram as remoções por ID (vínculos → perfis → espaços → contas).
- Capturas autenticadas em [evidence/02/auth](../evidence/02/auth) (A–D, desktop e mobile), inspecionadas: equipe de validação e "(você)" corretos, sem overflow.
- Advisors de segurança: só o aviso de proteção contra senhas vazadas desativada (configuração do Auth, não do schema). Recomendado ativar no painel; pode exigir plano pago.
- Limites: Chromium com emulação mobile, sem Safari/aparelho físico. `npm run db:types` via CLI não executado (exige `supabase login`); tipos atuais vieram do projeto pelo conector.

Próximos tickets desbloqueados: **03** (recuperar senha) e **05** (criar mapa).
