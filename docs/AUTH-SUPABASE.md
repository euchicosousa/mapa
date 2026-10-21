# Ticket 02 — Supabase final, sem banco local ou staging

## Decisão vigente

O usuário determinou um único projeto Supabase, usado desde o desenvolvimento até a publicação. Não instalar Docker/Podman, não iniciar Supabase local e não criar banco de staging. Frontend rodando no computador e frontend publicado usam o mesmo backend.

Estado: **projeto `mapa` (`bodxafqkqlyfoyfgahyj`, sa-east-1) criado; migração `20261019140900_identity_and_workspaces` aplicada; primeiro admin e equipe criados; scripts Auth/RLS e tipos adaptados ao remoto; test:rls 7/7 e test:e2e:auth 14/14 no projeto.** Ticket 02 done.

## Entradas necessárias

Identificar a referência/URL do projeto final e acesso administrativo disponível por conector ou CLI. Configurar VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no arquivo de ambiente local do frontend. Esse arquivo é local; o banco não é. Segredos administrativos permanecem somente no processo administrativo seguro. Identificar e-mail do primeiro administrador, nome da equipe e identidades autorizadas para validação.

## Sequência do executor

1. Inspecionar schema e histórico do projeto escolhido. Revisar a migração de identidade existente e aplicar somente o que ainda estiver pendente, mantendo histórico sincronizado. Não executar reset, truncate, drop schema nem seed local.
2. Conferir configurações de Auth no serviço hospedado e executar bootstrap idempotente da equipe real/primeiro admin após revisar entradas e destino. Não sobrescrever senha de conta preexistente.
3. Adaptar geração de tipos para o projeto remoto sem container. Validar project ref, gravar saída em temporário e substituir tipos somente com sucesso. Os tipos atuais são provisórios; esse critério continua obrigatório.
4. Adaptar scripts de teste Auth/RLS: retirar dependência de supabase status/loopback e substituir por validação explícita do destino esperado, credenciais seguras e recursos identificados por execução. Seguir contrato seção 7. Não desproteger seed-local para rodá-lo no remoto.
5. Atualizar package.json e scripts: seed:local/local:configure deixam de fazer parte do fluxo. Descontinuar os atalhos ou substituí-los por ferramentas remotas específicas e verificadas; não manter instruções que peçam Docker como pré-requisito.
6. Rodar verificações estáticas, advisors remotos e smoke Auth/RLS com as ferramentas já adaptadas. Registrar evidências reais, limpar apenas recursos temporários da execução e preservar dados da equipe.

## Validação Auth/RLS no projeto final

`scripts/validation-run.mjs` cria, por execução, um `run_id`, dois espaços temporários (X, Y) e quatro contas temporárias (A admin X, B membro X, C membro Y, D sem vínculo) com senhas aleatórias mantidas só em memória. Os IDs criados ficam em `.validation-runs/<run_id>.json` (ignorado, sem senhas) e a limpeza remove exatamente esses IDs, na ordem vínculos → perfis → espaços → contas. Dados da equipe real nunca são tocados.

Nos testes de navegador (`playwright.auth.config.ts` e as configs que usam `tests/auth/global-setup.mjs`), cada arquivo de teste, em cada projeto (desktop e mobile), recebe a sua própria execução, criada por `tests/auth/file-run.ts` (ticket 38). Assim, um arquivo que troca a senha de B, aceita um convite ou cria mapas não afeta os outros. A execução global do `globalSetup` serve só para listar os testes e é a "pai" das execuções por arquivo: cada arquivo limpa a sua no `afterAll`, e o teardown global roda `validation-run.mjs cleanup-children <run_id>` para remover qualquer filha que tenha sobrado (por exemplo, de um arquivo com todos os testes pulados). Para uma execução interrompida, `npm run validation:cleanup` limpa todos os registros pendentes.

Antes de criar qualquer recurso, o destino é conferido: `MAPA_PROJECT_REF` precisa bater com a URL de `.env.local`, e a chave precisa ser secreta.

Por decisão do usuário (19/10/2026), as duas variáveis podem ficar no arquivo local `.env.validation`, ignorado pelo git e recusado se não estiver com permissão 600. O Vite não lê esse arquivo e ele não entra no bundle. Variáveis já definidas no terminal têm prioridade. Criar uma vez, digitando a chave sem eco e sem histórico:

```sh
read -s "k?Chave secreta do Supabase: " && printf 'MAPA_PROJECT_REF=bodxafqkqlyfoyfgahyj\nSUPABASE_SECRET_KEY=%s\n' "$k" > .env.validation && chmod 600 .env.validation && unset k
```

Depois, `npm run test:integration` roda `test:rls` e `test:e2e:auth`. Para revogar: apagar o arquivo e, se necessário, gerar nova chave secreta no painel.

Se uma execução for interrompida, `npm run validation:cleanup` limpa as execuções registradas. O limite de logins do Auth (por IP, em 5 minutos) pode ser atingido ao repetir as suítes em sequência; aguarde antes de repetir.

Tipos: `npm run db:types` usa `supabase gen types --project-id` (exige `npx supabase login`) e só substitui o arquivo com saída completa. Os tipos atuais foram gerados do projeto pelo conector Supabase.

Scripts do fluxo local (seed, fixtures fixas, configure-local, seed.sql) foram movidos para `.scratch/mapa-mental/legacy-local/` como histórico; não fazem parte do fluxo.

## Estratégia de verificação no mesmo projeto

Login e navegação podem ser verificados com contas autorizadas. Cenários que alteram senha, vínculo, metadata ou revogação usam contas dedicadas temporárias no mesmo projeto, nunca colegas reais. Gerar senhas aleatórias; registrar run_id e IDs exatos dos recursos criados. Limpeza remove somente esses recursos e nunca usuários ou dados preexistentes. Não criar ambiente permanente de testes.

Os cenários A/B/C/D continuam como papéis na matriz de acesso. Usuário anônimo/sem vínculo testa negação; recursos temporários entre equipes só quando a política exigir. Nenhum seed fixo de Equipe X/Y ou senha de fixture deve ser aplicado automaticamente ao banco final.

Alterações via HTTP já confirmadas precisam de limpeza por IDs; não prometer rollback único de todo o E2E. Reset limpo deixou de ser critério: conferir migrações pendentes/aplicadas, schema resultante e testes delimitados. Falta de acesso ao projeto é bloqueio externo concreto; falta de Docker não é.

## Implementação e segurança

- Configurar no projeto hospedado: signup público e anônimo desativados; API expõe apenas public, nunca private; redirects permitem o frontend local e a URL publicada quando definida. supabase/config.toml documenta a intenção, mas não configura automaticamente o projeto remoto.
- Migração `20261019140900_identity_and_workspaces.sql` (renomeada para a versão registrada no projeto): profiles, workspaces e workspace_members, chaves estrangeiras, índices e RLS. SELECT somente para membros ativos; perfil de colega inativo permanece visível aos membros ativos da mesma equipe. Anon não tem SELECT; authenticated não tem INSERT/UPDATE/DELETE. Não há escrita de papel no frontend.
- Helpers SECURITY DEFINER ficam em private, têm search_path vazio, nomes qualificados e auth.uid() explícito. Grants EXECUTE são limitados aos helpers usados pelas políticas; a função de trigger não é executável por anon/authenticated/PUBLIC. O uso elevado evita recursão de políticas de membership e precisa passar advisors/testes no banco real.
- Trigger Auth cria perfil com nome para apresentação. Metadata não concede equipe, papel ou autorização. Não há endpoint público de bootstrap.
- SDK Supabase mantém sessão e renovação. A autorização usa getUser (identidade confirmada pelo servidor) e consulta vínculo ativo com RLS, nunca o papel informado em storage/metadata. Instalação exige um único vínculo ativo por conta na interface atual; múltiplos vínculos resultam em indisponibilidade, sem seleção silenciosa de equipe.
- Router Data Mode controla loaders/actions e destinos internos permitidos. Rotas privadas aguardam verificação; sem configuração/sessão redirecionam ao login, sem vínculo a /sem-acesso, falha de serviço tem erro recuperável. Não há mapas/nós nesta etapa.
- Eventos Auth: só troca real de conta, saída ou restauração do bfcache bloqueiam e limpam dados; o mesmo usuário (SIGNED_IN repetido, TOKEN_REFRESHED, foco, retorno à aba) só revalida com o roteador ocioso, para não interromper ações em andamento.
- Query mantém dados remotos. Transições de sessão cancelam/limpam caches e resetam editor; uma barreira de privacidade oculta dados enquanto o acesso é revalidado. Troca de conta, refresh, retorno à aba e restauração do histórico revalidam acesso. Não existe cache persistente de documentos nesta fatia.
- Logout usa signOut com scope local (este navegador), mostra falha compreensível se não concluir e não afirma revogação imediata dos access tokens emitidos. Servidor/RLS continuam sendo a fronteira de acesso.
- Recuperação/callback/definição de senha foram concluídos no ticket 03. `detectSessionInUrl` permanece desativado porque o callback consome e limpa explicitamente os tokens; fluxo, URLs remotas e validação real estão em [AUTH-LINKS.md](AUTH-LINKS.md).

## Primeiro administrador — procedimento administrativo

Para uma instalação de destino, primeiro aplicar a migração revisada e desativar cadastro público no ambiente Auth. Em um terminal administrativo seguro, disponibilizar **no ambiente**, sem gravar no repositório ou chat:

- `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (chave secreta/service_role apenas neste processo).
- `MAPA_ADMIN_EMAIL`, `MAPA_ADMIN_PASSWORD`, `MAPA_ADMIN_NAME`.
- `MAPA_WORKSPACE_ID` (UUID estável) e `MAPA_WORKSPACE_NAME`.

Executar `npm run bootstrap:admin` somente quando houver autorização para configurar esse destino. O script busca identidade por e-mail, cria se necessário, garante espaço e vínculo admin ativo, preserva senha de identidade existente e pode ser repetido com as mesmas entradas. Não imprime credenciais. Remover as variáveis administrativas ao terminar. Conferir a conta no login real e confirmar o papel no banco. Esse procedimento foi escrito e deve ser revisado/validado antes do uso no projeto escolhido. O primeiro admin/equipe agora pertence ao ticket 02; não aguardar o ticket 26.

## Verificações sem integração remota

Typecheck, lint, testes unitários, build, bundle e smoke público continuam úteis e executáveis no computador. Não comprovam sozinhos login ou RLS. Preservar essa distinção no registro do ticket.
