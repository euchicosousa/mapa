# Isolamento e integridade — ticket 25

Verificado em 20/10/2026 (America/Fortaleza), no projeto Supabase final `mapa` (`bodxafqkqlyfoyfgahyj`). Node 22.17.0, supabase-js 2.118.0. Nenhuma alteração de dados reais, reset, seed global, migração ou deploy nesta entrega.

## Reproduzir

```sh
npm run test:security
npm run test:rls
npm run test:invitations
npm run test:members
node --test tests/integration/ai-budget.test.mjs
npx playwright test --config playwright.auth.config.ts member-access.spec.ts ownership.spec.ts deletion.spec.ts import.spec.ts
```

Os scripts exigem `.env.local` e `.env.validation` privados, conforme AUTH-SUPABASE.md. Usam a chave publicável e JWTs reais das contas temporárias A (admin de X), B (membro de X), C (membro de Y) e D (sem equipe), além de anon. A chave administrativa prepara e limpa somente recursos da execução e inspeciona invariantes. Não comprova autorização de usuário em lugar dos JWTs. Senhas/JWTs ficam em memória, nunca no arquivo de evidência.

`security.test.mjs` acrescenta oito cenários com 248 verificações registradas em `evidence/25/http-matrix.json`, além das asserções de documentos, erros e concorrência. O arquivo contém fronteira/papel/resultado; não contém tokens, e-mails, conteúdo de mapas ou respostas administrativas. O script foi incluído em `test:integration`.

Os testes negativos de IA não chamam o provedor. Enviam payloads adversariais e exercitam a RPC do worker após revogação: o resultado deve ser `stale` sem inserir nós. Não há adaptador falso instalado, resultado apresentado como IA ou aumento de orçamento. A reserva contábil permanece limitada ao workspace descartável e é eliminada na limpeza por IDs.

## Matriz de autorização

Todos os SELECT foram filtrados pelos IDs descartáveis da execução, com comparação exata dos conjuntos retornados. Não se exportaram dados de colegas reais.

| Fronteira | A, admin X | B, membro X | C, membro Y | D/anon |
| --- | --- | --- | --- | --- |
| Workspaces e membros | X | X | Y | nenhum |
| Perfis | colegas de X | colegas de X | colegas de Y | nenhum |
| Mapas, nós, projetos | X | X | Y | nenhum |
| Preferências | apenas próprias em X | apenas próprias em X | apenas próprias em Y | nenhum |
| Tabela de convites | admin de X | nenhum | nenhum (C não é admin) | nenhum |
| Log de operações e jobs IA, SELECT direto | negado | negado | negado | negado |
| INSERT/UPDATE/DELETE de conteúdo, equipe e convites | negado | negado | negado | negado |
| CRUD das próprias preferências | permitido por RLS | permitido por RLS | permitido por RLS | negado |
| Preferências de outra pessoa/equipe | negado | negado | negado | negado |
| RPCs do worker e de envio de convites | negado | negado | negado | negado |
| Schema `private` via HTTP | não exposto | não exposto | não exposto | não exposto |

Convites destinados à própria conta são retornados pela RPC dedicada `pending_workspace_invitations`; isso não concede leitura da tabela nem administração da equipe. A suíte de convites verifica aceite pelo destinatário, expiração, revogação e concorrência, sem envio de mensagens a pessoas reais.

A não consegue ler, editar, excluir, transferir ou criar mapas em Y, desativar C em Y ou revogar convite de Y, mesmo conhecendo os UUIDs. Modificar `user_metadata.role`, `workspace_id` e um objeto `app_metadata` aninhado em `user_metadata` não cria vínculo ou privilégio.

Escritas diretas nas nove tabelas protegidas exigem erro PostgreSQL `42501`, em vez de considerar qualquer erro de validação como prova de autorização. Preferências são a exceção intencional: CRUD próprio funciona; mudar `user_id`, mover para um mapa de Y e sobrescrever preferências alheias falham. O documento original é comparado depois das tentativas.

A suíte RLS existente cobre falsificação de `ownerId`/`createdBy`/`created_by`/`updatedBy`/`source`, campos desconhecidos, raiz duplicada/ausente, pai de outro mapa, ciclos e profundidade, importação desconectada ou fora do formato e limites. Rejeições preservam documento, revisão e histórico. A nova corrida envia duas operações com a mesma revisão: exatamente uma confirma e a outra recebe `CONFLICT`; repetição idêntica é idempotente e payload diferente com o mesmo ID conflita.

A desativação foi verificada com **o mesmo access token anterior**, ainda válido na autenticação. Leitura/escrita ficam negadas porque a autorização consulta o vínculo atual. A finalização tardia de IA retorna `stale`, sem alterar o documento. Exclusão lógica remove a visibilidade de mapa, nós e preferências para todos os papéis; snapshots antigos não restauram o mapa. Autoria histórica permanece após edição por colega, transferência e revogação.

## Catálogo remoto e funções privilegiadas

Snapshots: `evidence/25/tables-before.json`, `functions-before.json`, `definer-functions.json` e `migrations-before.json`. São metadados/definições, sem dados de usuários.

- Dez tabelas em `public` e quatro tabelas internas em `private`, todas com RLS habilitada; nenhuma view de aplicação que contorne RLS.
- Sessenta funções em `public`/`private`: nenhuma com EXECUTE para `PUBLIC` ou `anon`; todas com `search_path` vazio e referências de objetos qualificadas.
- As funções públicas são SECURITY INVOKER. As 29 SECURITY DEFINER intencionais ficam em `private`, não exposto à API.
- Histórico remoto: 33 versões/nomes correspondem exatamente aos 33 arquivos locais. Tipos TypeScript regenerados do projeto final e validados por typecheck/build.

As SECURITY DEFINER têm finalidades delimitadas:

| Grupo | Motivo e limite |
| --- | --- |
| `is_active_member`, `shares_workspace`, `is_workspace_admin`, `can_read_map` | Consultar vínculos sem recursão de RLS; usam `auth.uid()` e o workspace/pessoa alvo, sem papel vindo de metadata. |
| Comandos, histórico, criação/cópia/importação, projetos e controle de membros | Clientes não escrevem diretamente nas tabelas. A implementação privada verifica ator, vínculo ativo, autorização da ação e revisão, executando a transação validada. Importação deriva o workspace do vínculo, sem aceitar destino/autoria do arquivo. |
| Aceite e consulta de convites, leitura/cancelamento de jobs | Ator autenticado e destinatário/solicitante validados; conhecer UUID não basta. |
| Reserva/finalização de IA e convites, disponibilidade e allowlist de validação | EXECUTE somente para o servidor (`service_role`) nos pontos de entrada. As funções internas de aplicação de resultado/cópia não têm EXECUTE nem para service_role. Ator/contexto/vínculo são revalidados no servidor. |
| Triggers de perfil, raiz e responsável ativo | Não executáveis por clientes. Garantem apresentação de perfil e invariantes, inclusive para gravações administrativas. Metadata é usada somente para nome exibido. |

A auditoria segue as orientações oficiais de [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) e [funções](https://supabase.com/docs/guides/database/functions). O changelog foi consultado: a remoção futura de cifras TLS antigas não exige mudar os clientes modernos utilizados; as mudanças de extensões PostgreSQL anunciadas não são usadas pelo domínio desta entrega.

## Advisors e limitações

O advisor de segurança não apontou funções públicas privilegiadas, search_path mutável ou tabelas sem RLS. Permanecem os avisos abaixo, registrados sem transformar ausência de política em concessão de acesso:

- **INFO, cinco tabelas com RLS sem policies:** `map_operations` e quatro tabelas `private.ai_*`. Negação por padrão é intencional: somente transações internas/servidor operam nesses dados. Os grants e os testes HTTP confirmam a negação aos clientes. [Explicação do advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- **WARN, proteção contra senhas vazadas desativada:** a detecção adicional do Auth continua pendente. A documentação disponibiliza a opção em Pro ou superior; não houve mudança de plano, cobrança ou configuração de Auth nesta entrega. Isso é um risco residual de autenticação, não evidência de quebra do isolamento testado. [Configuração e remediação](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- **INFO de desempenho:** sete FKs sem índice cobrindo a coluna e um índice de busca sem uso observado. Não se removeram índices ou adicionaram migrações sem evidência de necessidade de desempenho. [FKs sem índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) e [índices sem uso observado](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

Snapshots completos dos advisors estão em `evidence/25/security-before.json` e `performance-before.json`. Os resultados comprovam as fronteiras e os cenários exercitados, sem constituir um pentest completo ou garantia contra toda vulnerabilidade.

## Bundle e logs

`npm run test:bundle` aprovou a fronteira pública com configuração válida e inválida. Uma varredura adicional comparou, em memória, os valores reais da chave administrativa e da OpenAI com todos os arquivos de `dist`: nenhuma ocorrência. Somente contagens/rótulos foram exportados em `evidence/25/production-secret-scan.json`, nunca os valores. Os tipos remotos regenerados não carregam valores de configuração.

Consulta agregada dos logs de funções na janela de 24 horas observada: 2.934 registros, 74 eventos `ai_generation`, zero correspondências aos padrões de segredo/JWT e zero campos fora da allowlist do logger nesses eventos. Somente contagens foram lidas/exportadas. A allowlist contém evento, ID, estado, código, duração e contagem de tokens; não conteúdo dos mapas. O resultado e as limitações da busca por padrões estão em `evidence/25/logs-summary.json`. A inspeção não afirma ausência de todo formato possível de segredo ou de registros fora da janela.

## Verificações de interface e preparação da suíte

A suíte conjunta inicialmente encontrou um problema de preparação: cenários de importação anteriores deixavam mapas no nome de B; o servidor recusava corretamente desativar B enquanto ainda era responsável. O teste de acesso agora transfere, via RPC de A, somente os mapas restantes dessa conta/equipe descartáveis, validando workspace e responsável antes de cada transferência. A regra de produto não foi alterada. A falha original está em `evidence/25/shared-fixture-failure.md`.

As capturas do cenário de acesso agora usam a pasta de saída da própria execução, evitando sobrescrever evidências de tickets anteriores. Resultado final da suíte conjunta após corrigir a preparação: **18/18 aprovados**, em 1440×900 e 390×844. Capturas de bloqueio de responsável, estado inativo e conta sem acesso foram copiadas para `evidence/25/desktop-member-*.png` e `mobile-member-*.png`. Trata-se de emulação Chromium nas duas viewports, não teste em celular físico.

## Resultado final

- 70 cenários de integração aprovados: RLS 46, matriz de segurança 8, convites 6, acesso de membros 7 e orçamento IA 3.
- 18 casos de interface aprovados na rodada final conjunta, sem retries automáticos.
- 124 testes unitários/componentes em 20 arquivos aprovados.
- Build/typecheck, lint e fronteira pública do bundle aprovados. Os avisos já existentes de tamanho de chunk/anotações Zod não impediram o build.
- Nenhuma alteração de política ou permissão foi necessária; não se alterou o produto para fazer o teste passar. Tipos remotos foram regenerados.
- Limpeza por IDs terminou em todas as rodadas. Consulta somente de leitura confirmou zero usuários e zero workspaces temporários remanescentes; `.validation-runs` vazio.

Resumo legível por máquina em `evidence/25/verification-summary.json`. O aviso de senhas vazadas acima permanece como risco residual documentado; não impede comprovar as fronteiras de isolamento e integridade exercitadas. Status do ticket: **done**. O ticket 26 está desbloqueado e não foi iniciado.

Atualização de 21/10/2026 (ticket 26): o teste antigo de cadastro aceitava qualquer erro, sem exigir `signup_disabled`. A conferência de configuração encontrou cadastro público ainda habilitado. Foi desabilitado explicitamente no Auth, e o teste endurecido passou. As fronteiras RLS verificadas no ticket 25 continuam válidas; a afirmação anterior de cadastro fechado não estava comprovada por aquele teste. Ver PUBLICACAO.md.
