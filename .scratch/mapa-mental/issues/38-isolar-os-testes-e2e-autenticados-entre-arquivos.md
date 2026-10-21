# 38: Isolar os testes E2E autenticados entre arquivos

**What to build:** Fazer `npm run test:e2e:auth` passar inteiro numa única execução, sem que um arquivo de teste altere contas ou equipes usadas pelos outros.

**Blocked by:** nenhum.

**Status:** done — concluído em 21/10/2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e o registro do ticket 30, onde o problema apareceu. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Contexto

A configuração `playwright.auth.config.ts` cria uma única execução de validação no `globalSetup` (contas A, B, C, D e as equipes X e Y), compartilhada por todos os arquivos e pelos dois projetos (desktop e mobile). Na primeira execução da suíte inteira, em 21/10/2026 (ticket 30), deram 61 aprovados, 41 reprovados e 22 pulados. Três efeitos colaterais explicam as falhas:

- `tests/auth/password.spec.ts`, no fluxo `recovery`, troca a senha da conta B. Depois disso, todo `signIn` de B usa a senha antiga e recebe `invalid_credentials`.
- `tests/auth/invitations.spec.ts` acrescenta um membro ativo à equipe; `ownership.spec.ts:48` espera uma lista exata de candidatos a responsável.
- Vários arquivos criam mapas nas equipes compartilhadas; `maps.spec.ts:21` espera que C veja "Nenhum mapa ainda".

Até aqui, cada ticket rodava a suíte por arquivo, o que escondia o problema.

## Implementação definida

1. `password.spec.ts`: usar uma conta exclusiva criada para o teste (o helper já cria a conta do fluxo `invite`; fazer o mesmo para `recovery`), nunca a B compartilhada.
2. `invitations.spec.ts`: convidar para uma equipe exclusiva do teste, ou remover a filiação criada ao final, por ID.
3. Asserções de listas exatas (`ownership.spec.ts`, `maps.spec.ts` e outras do mesmo tipo) passam a filtrar pelos recursos criados no próprio teste, em vez de supor equipes vazias.
4. Avaliar se cada arquivo deve ter a sua própria execução de validação (fixture por arquivo em vez de `globalSetup`), mantendo a limpeza por IDs.

## Critérios de aceite

- [x] `npm run test:e2e:auth` passa inteiro, desktop e mobile, numa única execução.
- [x] Rodar duas vezes seguidas também passa, sem resíduos da primeira.
- [x] A limpeza final confirma zero contas e equipes da execução no banco final, e o administrador real é preservado.

## Como verificar

`npm run test:e2e:auth` duas vezes no terminal do usuário (exige `SUPABASE_SECRET_KEY`), mais a consulta de limpeza já usada nos tickets 25 a 28.

## Limites desta entrega

Mudanças só em testes e scripts de validação. Nenhuma mudança no app ou no banco.

## Dependências externas

Terminal do usuário com a chave secreta para rodar a suíte.

## Registro do executor

**Abordagem:** em vez de corrigir só os três arquivos encontrados, cada arquivo de teste, em cada projeto (desktop e mobile), passou a ter a sua própria execução de validação, com contas A–D e equipes X e Y novas. Isso cobre os três casos do contexto e qualquer outro efeito colateral entre arquivos.

- `tests/auth/file-run.ts` (novo): `fileRun()` cria a execução do arquivo num processo filho (`validation-run.mjs create <pai>`), registra `test.afterAll` para limpá-la e a devolve. No processo principal, que só lista os testes (`TEST_WORKER_INDEX` ausente), devolve a execução global, porque ali só importa o formato.
- Os 19 arquivos `tests/auth/*.spec.ts` trocaram `JSON.parse(process.env.MAPA_VALIDATION_RUN …)` por `fileRun()`. Nenhuma asserção foi alterada: com equipes exclusivas por arquivo, as listas exatas de `ownership.spec.ts` e `maps.spec.ts` voltaram a valer.
- `scripts/validation-run.mjs`: `createRun(target, parent)` grava `parent` no registro; comando novo `cleanup-children <pai>` remove todas as execuções filhas. `tests/auth/global-setup.mjs` roda `cleanup-children` e depois `cleanup` no teardown, para que nada sobre mesmo quando o `afterAll` não roda (arquivos com todos os testes pulados, como os de IA sem `MAPA_AI_VALIDATION=1`).
- Documentado em `docs/AUTH-SUPABASE.md`.

O item 1 da implementação (conta exclusiva no `password.spec.ts`) e o item 2 (equipe exclusiva no `invitations.spec.ts`) ficaram resolvidos pela execução por arquivo, sem mudança nesses testes.

**Execuções completas de `playwright test --config playwright.auth.config.ts`** (equivalente a `npm run test:e2e:auth`), rodadas pelo executor com a chave de `.env.validation`:
1. 101 aprovados, 1 reprovado, 22 pulados (15,5 min). A falha foi em `accessibility.spec.ts:116` no desktop, o segundo teste da execução: o editor não apareceu em 15 s depois de "Novo mapa". O mesmo arquivo, repetido 3 vezes sozinho no desktop, passou 12/12. Causa provável: primeira compilação do chunk do editor pelo servidor de desenvolvimento do Vite. Não está ligada ao isolamento e não foi tratada aqui.
2. **102 aprovados, 0 reprovados**, 22 pulados (15,6 min).
3. **102 aprovados, 0 reprovados**, 22 pulados (15,3 min).

As execuções 2 e 3 cumprem o critério das duas execuções seguidas. Os 22 pulados são os testes de IA paga (`ai.spec`, `ai-limits.spec` e `ai-cancellation.spec`), que só rodam com `MAPA_AI_VALIDATION=1`, por decisão anterior; não foram executados.

**Limpeza:** `.validation-runs/` vazio depois de cada execução. A consulta no banco final confirma 0 contas `mapa-validacao-…`/`mapa-link-…`, 0 equipes "Validação …", 1 conta no total e 1 administrador ativo, que é o real, preservado. Antes da primeira execução havia um registro pendente da execução do usuário às 19:19 (`20261021-4bb261`: 5 contas e 2 equipes temporárias); foi limpo com `validation-run.mjs cleanup`.

Typecheck, lint e `format:check` sem erros.
