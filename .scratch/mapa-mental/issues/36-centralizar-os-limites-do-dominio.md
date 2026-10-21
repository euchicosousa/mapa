# 36: Centralizar os limites do domínio

**What to build:** Uma fonte única para os limites do mapa no cliente e um teste que acuse divergência com o SQL.

**Blocked by:** 30: Consolidar as migrações em uma base

**Status:** done — concluído em 21/10/2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Contexto

Os limites (500 nós por mapa, 30 níveis, 1 a 500 caracteres por nó, 1 a 120 caracteres no título, 120 caracteres por filho gerado pela IA e 4 filhos por geração) estão escritos à mão em vários arquivos do cliente (`src/maps/api.ts`, `src/maps/drafts.ts`, `src/routes/editor.tsx`, `src/maps/structure.ts`), nas Edge Functions e nas funções SQL. Uma mudança feita só num lado gera erros de validação que a interface não explica.

## Implementação definida

1. Criar `src/maps/limits.ts` com as constantes e usá-las em todo o cliente, inclusive nas mensagens de erro.
2. Nas Edge Functions, importar as mesmas constantes de `supabase/functions/_shared/limits.ts` (o Deno não importa de `src/`; manter um arquivo espelho).
3. Criar um teste que compare as constantes do cliente com o espelho e com os valores nas funções SQL da migração-base (por busca textual ou consulta ao catálogo).

## Critérios de aceite

- [x] Nenhum número mágico de limite fora de `limits.ts` e do espelho.
- [x] O teste falha se algum dos três lados mudar sozinho.
- [x] Typecheck, lint e `npm test` passam.

## Como verificar

Alterar um limite só num lado e confirmar que o teste falha; desfazer a alteração.

## Limites desta entrega

Não mudar nenhum valor de limite.

## Dependências externas

Nenhuma.

## Registro do executor

`src/maps/limits.ts` concentra oito constantes: `MAP_NODES_MAX` 500, `MAP_DEPTH_MAX` 30, `NODE_TEXT_MAX` 500, `MAP_TITLE_MAX` 120, `ENTITY_NAME_MAX` 120 (nome e cliente de projeto e busca da biblioteca), `AI_CHILDREN_COUNT` 4, `AI_CHILD_TEXT_MAX` 120 e `AI_GUIDANCE_MAX` 1000. O espelho `supabase/functions/_shared/limits.ts` tem as três da IA, que são as únicas usadas pelas Edge Functions. `NODE_TEXT_MAX` continua exportado por `api.ts`, para não mudar importações existentes.

Números trocados pelas constantes em `api.ts`, `backup.ts` (inclusive mensagens), `drafts.ts` (o índice máximo agora é `MAP_NODES_MAX - 1`), `preferences.ts`, `structure.ts`, `visibility.ts`, `ai.ts`, `routes/editor.tsx`, `routes/ai-generation.tsx`, `routes/library.tsx`, `routes/map-details.tsx`, `routes/projects.tsx` e `state/editor.ts`. Neste último, o título da cópia usa `MAP_TITLE_MAX - COPY_SUFFIX.length` no lugar do 112 fixo, com o mesmo resultado (120 − 8). Nas Edge Functions, `provider.ts` (contagem, tamanho, JSON schema e o "1 a 120 caracteres" do prompt) e `handler.ts` (orientação). O texto do prompt gerado continua idêntico; a palavra "quatro", por extenso, foi mantida no prompt e nas mensagens da interface.

`src/maps/limits.test.ts`: compara o espelho com o cliente e confere nove trechos do SQL nas migrações, lidas em ordem (vale o último trecho encontrado, para que uma migração futura que redefina uma função entre na comparação): `max_nodes constant`, `max_depth constant`, check de `nodes.text`, de `maps.title` e de `projects.name`, `char_length(p_query)`, `jsonb_array_length(p_children)`, tamanho de cada filho da IA e `char_length(p_guidance)`. Limitação: a comparação usa um trecho representativo por limite. Se uma função SQL tiver outro literal (por exemplo `total > 500`) e só ele mudar, o teste não pega.

Teste de mutação: mudar sozinho `MAP_DEPTH_MAX` no cliente, `AI_GUIDANCE_MAX` no espelho e `max_nodes` numa migração nova de teste fez o teste falhar nos três casos; restaurado, voltou a passar. A migração de teste foi apagada e nada foi aplicado no banco.

Verificações: typecheck e lint sem erros; `npm test` com 23 arquivos e 131 testes (129 + 2 novos), inclusive `ai-handler.test.ts` e `ai-provider.test.ts`, que exercitam as Edge Functions alteradas; `format:check` e `test:bundle` aprovados. As Edge Functions não foram publicadas de novo: o comportamento é idêntico, e a versão publicada continua válida. A próxima publicação delas leva o `_shared/limits.ts` junto, porque o bundler do Supabase inclui importações relativas.
