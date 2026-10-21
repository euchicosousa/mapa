# 36: Centralizar os limites do domínio

**What to build:** Uma fonte única para os limites do mapa no cliente e um teste que acuse divergência com o SQL.

**Blocked by:** 30: Consolidar as migrações em uma base

**Status:** draft

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Contexto

Os limites (500 nós por mapa, 30 níveis, 1 a 500 caracteres por nó, 1 a 120 caracteres no título, 120 caracteres por filho gerado pela IA e 4 filhos por geração) estão escritos à mão em vários arquivos do cliente (`src/maps/api.ts`, `src/maps/drafts.ts`, `src/routes/editor.tsx`, `src/maps/structure.ts`), nas Edge Functions e nas funções SQL. Uma mudança feita só num lado gera erros de validação que a interface não explica.

## Implementação definida

1. Criar `src/maps/limits.ts` com as constantes e usá-las em todo o cliente, inclusive nas mensagens de erro.
2. Nas Edge Functions, importar as mesmas constantes de `supabase/functions/_shared/limits.ts` (o Deno não importa de `src/`; manter um arquivo espelho).
3. Criar um teste que compare as constantes do cliente com o espelho e com os valores nas funções SQL da migração-base (por busca textual ou consulta ao catálogo).

## Critérios de aceite

- [ ] Nenhum número mágico de limite fora de `limits.ts` e do espelho.
- [ ] O teste falha se algum dos três lados mudar sozinho.
- [ ] Typecheck, lint e `npm test` passam.

## Como verificar

Alterar um limite só num lado e confirmar que o teste falha; desfazer a alteração.

## Limites desta entrega

Não mudar nenhum valor de limite.

## Dependências externas

Nenhuma.

## Registro do executor

Pendente.
