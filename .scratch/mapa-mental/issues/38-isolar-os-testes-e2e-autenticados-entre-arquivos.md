# 38: Isolar os testes E2E autenticados entre arquivos

**What to build:** Fazer `npm run test:e2e:auth` passar inteiro numa única execução, sem que um arquivo de teste altere contas ou equipes usadas pelos outros.

**Blocked by:** nenhum.

**Status:** draft

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

- [ ] `npm run test:e2e:auth` passa inteiro, desktop e mobile, numa única execução.
- [ ] Rodar duas vezes seguidas também passa, sem resíduos da primeira.
- [ ] A limpeza final confirma zero contas e equipes da execução no banco final, e o administrador real é preservado.

## Como verificar

`npm run test:e2e:auth` duas vezes no terminal do usuário (exige `SUPABASE_SECRET_KEY`), mais a consulta de limpeza já usada nos tickets 25 a 28.

## Limites desta entrega

Mudanças só em testes e scripts de validação. Nenhuma mudança no app ou no banco.

## Dependências externas

Terminal do usuário com a chave secreta para rodar a suíte.

## Registro do executor

Pendente.
