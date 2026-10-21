# 30: Consolidar as migrações em uma base

**What to build:** Substituir as 33 migrações incrementais por uma migração-base que represente o schema atual, sem alterar nada no banco de produção.

**Blocked by:** nenhum.

**Status:** done — concluído em 21/10/2026, com a abordagem adaptada por decisão do usuário (ver registro).

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Contexto

Em dois dias foram criadas 33 migrações. `private.apply_map_history` foi redefinida 10 vezes, `private.apply_map_command` 7 vezes e `public.get_map_document` 4 vezes. Para saber a versão vigente de uma função é preciso achar a última migração que a tocou. Vários nomes descrevem correções em cima de correções (`recheck_deleted_map_after_lock`, `avoid_snapshot_alias_collision`, `qualify_structural_depth`).

O contrato define ambiente único: o banco final é o único banco. Portanto, a consolidação não pode depender de reset nem de recriar o banco.

## Implementação definida

1. Gerar o schema atual do projeto remoto com `supabase db dump` (schema, sem dados), incluindo `public` e `private`, policies, grants e funções.
2. Comparar o dump com o resultado de aplicar as 33 migrações em ordem (por exemplo, num Postgres descartável local, nunca no projeto final) e resolver toda diferença antes de prosseguir.
3. Mover as migrações antigas para `supabase/migrations-arquivo/` (fora do caminho do CLI) e criar `supabase/migrations/<timestamp>_base.sql` com o dump revisado.
4. No projeto remoto, marcar a base como aplicada com `supabase migration repair`, sem executar o SQL. Documentar o procedimento em `docs/DEPLOY.md`.
5. Opcional e preferível: separar as funções em arquivos declarativos (`supabase/schemas/`), para que cada função tenha um único arquivo-fonte.

## Critérios de aceite

- [x] O schema gerado pela base é idêntico ao do banco remoto. *Adaptado por decisão do usuário em 21/10/2026 (sem Docker, sem banco descartável):* a base contém o dump da produção byte a byte, mais os objetos de fora dos schemas; a comparação estática com as 33 migrações não achou divergência. A aplicação da base num banco vazio **não** foi testada.
- [x] O histórico de migrações remoto lista a base como aplicada e `supabase migration list` não mostra pendências.
- [x] Nenhum comando destrutivo (`db reset`, `drop`) foi executado no projeto final.
- [x] `npm run test:integration` contra o banco final após a mudança. *Resultado parcial, ver registro:* `test:rls`, `test:security`, `test:invitations` e `test:members` passaram; no `test:e2e:auth`, 61 passaram e 41 falharam por falta de isolamento entre arquivos da própria suíte, problema anterior a este ticket e registrado no ticket 38.
- [x] `docs/DEPLOY.md` explica como criar migrações novas a partir da base.

## Como verificar

Diff de schema entre o dump remoto e um Postgres descartável construído só a partir da base; suítes de integração no terminal do usuário.

## Limites desta entrega

Não alterar nenhuma função, tabela ou policy. Mudanças de comportamento ficam para os tickets seguintes.

## Dependências externas

Acesso do Supabase CLI ao projeto final e um Postgres descartável local para a comparação (Docker ou equivalente).

## Registro do executor

**Mudança de abordagem (decisão do usuário, 21/10/2026):** sem Docker e sem banco descartável; tudo contra o banco de produção, aceitando o risco porque hoje só o usuário usa o app, que ainda está em construção. Para o dump, o usuário autorizou instalar o `pg_dump` 18.6 (Homebrew `libpq`). O passo 5 (schemas declarativos) não foi feito: `supabase db diff` exige Docker.

**Antes:** o histórico remoto tinha as mesmas 33 versões e nomes dos arquivos locais. Cópia do histórico (versão, nome, número de instruções e MD5) registrada antes do repair; os SQLs originais são os arquivos em `supabase/migrations-arquivo/`.

**Dump:** script de `supabase db dump --project-ref bodxafqkqlyfoyfgahyj --schema public,private --dry-run`, executado com o `pg_dump` local e o usuário temporário criado pelo CLI (sem senha do banco). Correção necessária no script impresso: `--schema='public|private'` entre aspas. Resultado: 2.765 linhas, 14 tabelas, 60 funções, 9 policies, 24 índices, 3 triggers, RLS nas 14 tabelas.

**Revisão estática contra as 33 migrações** (scripts em `evidence/30/`):
- 59/59 funções vigentes com corpo idêntico ao da última definição nas migrações. A 60ª, `private.finish_ai_generation_document`, vem de um `alter function … rename` e tem o corpo idêntico ao de `finish_ai_generation` em `20261020205922_cancel_ai_generation`.
- Tabelas (14), policies (9) e índices (24) iguais aos criados menos os removidos.
- Triggers: `maps_active_owner`, `maps_require_root` e `nodes_keep_root` (estes dois como constraint triggers) no dump; `on_auth_user_created` em `auth.users`, conferido no catálogo de produção.
- Nenhuma alteração manual fora das migrações foi encontrada.

**Base `supabase/migrations/20261021185253_base.sql`:** o dump, mais: `pg_trgm` em `extensions` (única extensão da qual o schema depende, por `gin_trgm_ops`), o trigger em `auth.users` e a linha inicial de `private.ai_settings` com os valores da migração original (`enabled = false`; em produção está `true` desde o ticket 22). Ficaram de fora os preenchimentos de dados (perfis de usuários já existentes e o livro de uso da IA), que não fazem sentido num banco vazio. As 33 migrações foram para `supabase/migrations-arquivo/` com `git mv`, com um README explicando que o CLI não lê a pasta.

**Repair:** `supabase migration repair --status applied 20261021185253` e `--status reverted` nas 33 versões antigas. Só a tabela `supabase_migrations.schema_migrations` mudou; nenhum SQL de schema foi executado. A primeira tentativa do `reverted` falhou sem efeito, porque o zsh não separou a lista de versões; foi repetida via `bash`.

**Depois:** `supabase migration list` retorna só `20261021185253` (local = remote). Um novo dump é idêntico ao anterior (`diff` vazio; SHA-256 iguais, arquivos `evidence/30/schema-antes.sql` e `schema-depois.sql`).

**Documentação:** `docs/DEPLOY.md` (seção "Migrações do banco": como criar migrações novas, alerta de que a base nunca foi aplicada num banco vazio, como gerar o dump sem Docker), `docs/OPERACAO.md` e `supabase/migrations-arquivo/README.md`.

**Integração (rodada pelo usuário em 21/10/2026, 19:25, 18,5 min):** o script encadeia as suítes com `&&` e o `test:e2e:auth` só começa se as anteriores passarem, então `test:rls`, `test:security`, `test:invitations` e `test:members` passaram. No `test:e2e:auth` (relatório Playwright, 102 testes): **61 aprovados, 41 reprovados, 22 pulados** (pulados por modo serial depois de falha). Nenhuma falha aponta para o schema. As causas, todas de estado compartilhado entre arquivos da mesma execução:
- `password.spec.ts` (fluxo de recuperação) troca a senha da conta B por uma nova aleatória. Depois dele, todo login de B falha com `invalid_credentials` ("E-mail ou senha incorretos"). Em `login.spec.ts` no mobile, A, C e D entram e só B falha. Isso explica as falhas de duração ~15 s (timeout de 15 s em `/login`).
- `ownership.spec.ts:48` no desktop: a lista de novos responsáveis tem um membro ativo a mais do que o esperado, provavelmente a pessoa que aceitou o convite em `invitations.spec.ts`.
- `maps.spec.ts:21` no desktop: a conta C deixa de ver "Nenhum mapa ainda" porque outros arquivos criaram mapas na equipe dela.

Os tickets anteriores rodaram essa suíte por arquivo (`test:e2e:auth -- password`, `-- canvas` etc.); a suíte inteira de uma vez não tinha sido executada desde o ticket 03. O conserto ficou no ticket 38. Os 61 aprovados incluem login, edição de nós, canvas, rascunhos, exclusão, duplicação, importação, exportação, convites, senha e acessibilidade no desktop, o que exercita as funções do banco.

**Risco residual:** a base nunca foi aplicada a um banco vazio. Pontos que podem falhar nesse cenário: `CREATE SCHEMA "public"` e `ALTER SCHEMA … OWNER` (inofensivos no Supabase) e a ordem de criação gerada pelo `pg_dump`, normalmente segura. Testar antes do primeiro uso num banco novo.
