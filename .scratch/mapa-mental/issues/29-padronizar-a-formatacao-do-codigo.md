# 29: Padronizar a formatação do código

**What to build:** Adotar um formatador automático e aplicá-lo uma única vez em todo o código, para que diffs e revisões fiquem legíveis.

**Blocked by:** nenhum.

**Status:** done — concluído em 21/10/2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Contexto

Hoje há 160 linhas com mais de 200 caracteres em `src/` e 33 com mais de 300. As Edge Functions (`supabase/functions/generate-children/handler.ts`, `supabase/functions/manage-invitation/delivery.ts`) estão em estilo quase minificado, e a formatação varia entre arquivos (`deleted:false` ao lado de `deleted: false`, por exemplo). Não existe Prettier nem regra de formatação no ESLint.

## Implementação definida

1. Adicionar Prettier com versão fixa em `devDependencies`, `.prettierrc` (aspas simples, ponto e vírgula, `printWidth` 120) e `.prettierignore` cobrindo `dist`, relatórios, `src/lib/database.types.ts` e `supabase/migrations`.
2. Scripts `format` e `format:check`; integrar `eslint-config-prettier` para não haver regras em conflito.
3. Rodar a formatação em todo `src/`, `tests/`, `scripts/` e `supabase/functions/` num commit isolado, só de formatação.
4. Registrar o hash desse commit em `.git-blame-ignore-revs`, para que o `git blame` não aponte para ele.

## Critérios de aceite

- [x] `npm run format:check` passa sem alterações pendentes.
- [x] O commit de formatação não muda comportamento: typecheck, lint e `npm test` passam antes e depois, com o mesmo número de testes.
- [x] Nenhuma linha de código-fonte acima do limite configurado, exceto strings longas que o Prettier não quebra.
- [x] `.git-blame-ignore-revs` contém o commit de formatação.

## Como verificar

`npm run format:check && npm run typecheck && npm run lint && npm test`.

## Limites desta entrega

Somente formatação. Nenhuma renomeação, refatoração ou mudança de lógica no mesmo commit.

## Dependências externas

Nenhuma.

## Registro do executor

Prettier 3.9.9 e eslint-config-prettier 10.1.8 (versões fixas, `save-exact`). `.prettierrc.json`: aspas simples, ponto e vírgula, `printWidth` 120, `trailingComma` all. `.prettierignore` exclui build, relatórios, `.scratch`, `supabase/migrations`, `src/lib/database.types.ts`, `tests/fixtures` (backup de exemplo mantido byte a byte), Markdown, HTML, SQL e TOML. `eslint-config-prettier` entra como último item do `eslint.config.js`. Scripts `format` e `format:check` adicionados.

Commits: `c151c4f` (configuração) e `7f3e3ed` (somente formatação, 133 arquivos). O hash do segundo está em `.git-blame-ignore-revs`; a configuração `blame.ignoreRevsFile` foi aplicada no clone local, e o GitHub lê o arquivo automaticamente. Em clones novos: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

O Prettier precisou de duas passadas para estabilizar quatro arquivos (cadeias de métodos em `scripts/validation-run.mjs`, `src/state/editor.test.ts`, `tests/integration/rls.test.mjs` e `tests/integration/security.test.mjs`); depois da segunda, `format:check` fica limpo e uma nova passada não altera nada.

Verificações depois da formatação: `npm run format:check` limpo; `npm run typecheck` e `npm run lint` sem erros nem avisos; `npm test` com 22 arquivos e **129/129** testes, mesmo número de antes; `vite build` concluído; `npm run test:bundle` e `npm run test:deployment-config` (3/3) aprovados. As suítes autenticadas e de integração contra o banco final não foram executadas: a mudança é só de formatação e essas suítes não dependem dela.

Linhas acima de 120 caracteres em `src/`, `tests/`, `scripts/` e `supabase/functions/`: 1.803 antes e 97 depois. Acima de 200 em `src/`: 160 antes e 2 depois (`src/app/shell.tsx:91` e `src/routes/editor.tsx:89`). Todas as restantes são strings de interface, que o Prettier não quebra. O aviso de tamanho de chunk do Vite já existia e não foi tratado aqui.
