# 13: Organizar a biblioteca por projeto e responsável

**What to build:** Encontrar mapas por título, projeto/cliente e responsável sem carregar todo o conteúdo.

**Blocked by:** 05: Criar um mapa com responsável e reabri-lo

**Status:** done — implementação e aceites verificados no Supabase Primary, desktop e mobile.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Criar projects no workspace com RLS e operações autorizadas. Membros criam/renomeiam projetos; exclusão de projeto fica fora da v1. Associar/remover associação do mapa é comando versionado de conteúdo.
2. Biblioteca pagina 20 mapas por vez, com ordenação updated_at desc e id como desempate. Busca server-side por título com debounce 300 ms e filtros de projeto/responsável, preservados em search params.
3. Renomear mapa valida 120 caracteres e revisão. Cartões mobile/tabela desktop mostram título, projeto, responsável e data.
4. Índices alinhados às consultas e chave de cache por usuário/workspace/filtros. Ausência de resultados difere de biblioteca vazia; falha mantém filtros.

## Critérios de aceite

- [x] Criar projeto, associar mapa, filtrar e recarregar URL mantém seleção.
- [x] Resultados de X nunca incluem Y; consulta não devolve arrays de nós.
- [x] Paginação usa ordem estável e não repete item com timestamps iguais.
- [x] Busca antiga respondendo por último não substitui resultado atual.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

E2E com 45 mapas e duas equipes; teste de consulta/índices e mudança de filtros.

## Limites desta entrega

Sem pastas aninhadas, busca dentro de nós ou painel de clientes separado.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Executado em 19/10/2026, exclusivamente no projeto final **Primary / bodxafqkqlyfoyfgahyj**, sem banco local, staging ou simulações de integração.

### Entrega

- Projetos da equipe: criar/renomear nome e cliente opcional, limite de 120 caracteres, autoria derivada da sessão, RLS, sem exclusão. Repetição de criação mantém ID e dados; reutilização divergente é negada.
- Detalhes do mapa: título e associação/remoção de projeto por comandos versionados `rename_map` e `set_project`. Fila durável, revisão, idempotência e histórico preservados; raiz, nós, autoria e responsável não mudam.
- Biblioteca consultada no servidor: páginas de 20, `updated_at DESC, id DESC`, busca literal por título com debounce de 300 ms, projeto/cliente e responsável combináveis, filtros/página na URL. Consulta retorna somente metadados. Tabela desktop e cartões mobile; vazio, nenhum resultado e erro são estados diferentes.
- Cache por pessoa/equipe/filtros e cancelamento de consultas antigas. Falha preserva os filtros e permite nova tentativa.
- Migração **20261020023507_projects_and_library.sql**, criada pela CLI, revisada, dry-run e aplicada uma vez. `pg_trgm` 1.6, FK composta para projeto/equipe e índices de ordenação, projeto, responsável e busca parcial. Tipos gerados do Primary; 13 migrações locais/remotas conciliadas.
- Corrigido clique de **Concluir edição**: o blur iniciava salvamento e deslocava o botão entre pressionar/soltar, perdendo o clique. O botão agora mantém o foco até o clique concluir a edição. Teste verifica explicitamente saída da edição antes de desfazer.
- Recuperação de conflito usa o título local pendente ao criar a cópia, em vez do título antigo confirmado.

### Validação

- `npm run typecheck`, `npm run lint`: passaram.
- `npm test`: **57/57**, 11 arquivos.
- `npm run test:rls`: **33/33 reais**, incluindo 45 mapas com timestamps iguais, páginas 20/20/5 sem IDs repetidos, busca literal, filtros combinados, equipe estrangeira, autorização/revogação, idempotência, títulos/associação/histórico e nós intactos.
- `npm run test:e2e:auth -- tests/auth/library.spec.ts`: execução final **2/2**, desktop **1440×900** e mobile **390×844**, também sem overflow em 360 px. Projeto criado e renomeado pela UI, limite preserva entrada, associação/título, desfazer/refazer, 45 mapas de dois responsáveis e equipe estrangeira, URL recarregada, falha real/retry e resposta real antiga retida até a busca nova concluir.
- Regressão dirigida de criação/reabertura, reorganização, preferências e histórico: **7/8** inicialmente. A falha do histórico desktop foi reproduzida e diagnosticada por eventos de ponteiro. Após corrigir o produto, o histórico passou **4/4**, duas repetições em cada tamanho. Não se afirma uma execução combinada única sem falhas.
- `npm run build` e `npm run test:bundle`: passaram. Chunks principal **767,18 kB** e editor **213,63 kB**. Avisos preexistentes de anotações Zod e tamanho >500 kB; otimização geral permanece no 24.
- Advisors: nenhum novo achado de segurança; continuam INFO intencional de `map_operations` sem política/grant de cliente e WARN de proteção de senhas vazadas desativada. Nenhuma FK nova sem índice. Avisos de índices novos ainda não usados no pequeno conjunto de produção não representam benchmark de escala.
- Limpeza conferida: **1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações, 0 preferências, 0 projetos e 0 usuários de validação**. Registros locais de execução vazios. Dados anteriores preservados.

### Evidências e limites

[Resultados](../evidence/13/resultados.json), [catálogo e contagens](../evidence/13/backend-proof.json), [segurança](../evidence/13/security-advisors.json), [desempenho](../evidence/13/performance-advisors.json), capturas [desktop](../evidence/13/desktop/) e [mobile](../evidence/13/mobile/), regressões em `evidence/13/regressao`. Instruções em `docs/BIBLIOTECA.md`.

A paginação tem desempate estável; edições concorrentes podem reposicionar mapas entre consultas, sem snapshot congelado da biblioteca. Cópia de recuperação cria um novo mapa sem projeto, reassociável nos detalhes. Sem pastas, busca nos nós, exclusão de projetos ou benchmark de grandes bibliotecas. Sem nova configuração externa necessária, sem deploy e sem iniciar o 14.

Referências: [pg_trgm / PostgreSQL](https://www.postgresql.org/docs/current/pgtrgm.html), [extensões Supabase](https://supabase.com/docs/guides/database/extensions).

**Status final: done. Próximo ticket na sequência: 14.**
