# 29: Padronizar a formatação do código

**What to build:** Adotar um formatador automático e aplicá-lo uma única vez em todo o código, para que diffs e revisões fiquem legíveis.

**Blocked by:** nenhum.

**Status:** ready-for-agent — divisão aprovada pelo usuário em 21/10/2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Contexto

Hoje há 160 linhas com mais de 200 caracteres em `src/` e 33 com mais de 300. As Edge Functions (`supabase/functions/generate-children/handler.ts`, `supabase/functions/manage-invitation/delivery.ts`) estão em estilo quase minificado, e a formatação varia entre arquivos (`deleted:false` ao lado de `deleted: false`, por exemplo). Não existe Prettier nem regra de formatação no ESLint.

## Implementação definida

1. Adicionar Prettier com versão fixa em `devDependencies`, `.prettierrc` (aspas simples, ponto e vírgula, `printWidth` 120) e `.prettierignore` cobrindo `dist`, relatórios, `src/lib/database.types.ts` e `supabase/migrations`.
2. Scripts `format` e `format:check`; integrar `eslint-config-prettier` para não haver regras em conflito.
3. Rodar a formatação em todo `src/`, `tests/`, `scripts/` e `supabase/functions/` num commit isolado, só de formatação.
4. Registrar o hash desse commit em `.git-blame-ignore-revs`, para que o `git blame` não aponte para ele.

## Critérios de aceite

- [ ] `npm run format:check` passa sem alterações pendentes.
- [ ] O commit de formatação não muda comportamento: typecheck, lint e `npm test` passam antes e depois, com o mesmo número de testes.
- [ ] Nenhuma linha de código-fonte acima do limite configurado, exceto strings longas que o Prettier não quebra.
- [ ] `.git-blame-ignore-revs` contém o commit de formatação.

## Como verificar

`npm run format:check && npm run typecheck && npm run lint && npm test`.

## Limites desta entrega

Somente formatação. Nenhuma renomeação, refatoração ou mudança de lógica no mesmo commit.

## Dependências externas

Nenhuma.

## Registro do executor

Pendente.
