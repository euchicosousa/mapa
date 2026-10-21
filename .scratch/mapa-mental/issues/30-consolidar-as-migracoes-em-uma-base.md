# 30: Consolidar as migrações em uma base

**What to build:** Substituir as 33 migrações incrementais por uma migração-base que represente o schema atual, sem alterar nada no banco de produção.

**Blocked by:** nenhum.

**Status:** draft

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

- [ ] O schema gerado pela base é idêntico ao do banco remoto (diff vazio de tabelas, colunas, índices, policies, grants e funções).
- [ ] O histórico de migrações remoto lista a base como aplicada e `supabase migration list` não mostra pendências.
- [ ] Nenhum comando destrutivo (`db reset`, `drop`) foi executado no projeto final.
- [ ] `npm run test:integration` passa contra o banco final após a mudança.
- [ ] `docs/DEPLOY.md` explica como criar migrações novas a partir da base.

## Como verificar

Diff de schema entre o dump remoto e um Postgres descartável construído só a partir da base; suítes de integração no terminal do usuário.

## Limites desta entrega

Não alterar nenhuma função, tabela ou policy. Mudanças de comportamento ficam para os tickets seguintes.

## Dependências externas

Acesso do Supabase CLI ao projeto final e um Postgres descartável local para a comparação (Docker ou equivalente).

## Registro do executor

Pendente.
