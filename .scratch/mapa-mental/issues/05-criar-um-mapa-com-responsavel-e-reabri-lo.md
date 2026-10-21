# 05: Criar um mapa com responsável e reabri-lo

**What to build:** Qualquer membro cria um mapa, vê a raiz no editor e reabre o conteúdo salvo.

**Blocked by:** 02: Entrar com Supabase Auth e reconhecer a equipe

**Status:** done — verificado no projeto final: test:rls 13/13, test:e2e:auth 16/16 (desktop 1440×900 e mobile 390×844) e o fluxo de mapas 8/8 em repetição; recursos de validação removidos.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Criar maps, nodes e map_operations com constraints/RLS e fronteira de escrita do contrato. A operação de criação insere mapa+raiz atomicamente, com título padrão “Novo mapa” e raiz “Ideia central”. Criador/responsável vêm da sessão.
2. Implementar biblioteca mínima e ação criar. Navegar para /mapas/:mapId, carregar documento e mostrar raiz via React Flow.
3. Introduzir operação autenticada idempotente e leitura coerente do documento com revisão. IDs do cliente não permitem forjar autoria ou acessar outro workspace. Retornar patch canônico.
4. Adicionar estado vazio, carregando, falha e mapa inacessível. Não carregar nós de todos os mapas na biblioteca.

## Critérios de aceite

- [x] B cria mapa de X, fica responsável e A consegue abrir o mesmo mapa.
- [x] Recarregar preserva mapa, raiz e responsável; criação repetida com mesmo operationId não duplica.
- [x] Falha no meio da criação não deixa mapa sem raiz.
- [x] Usuário C não lê/cria mapa em X; escrita direta nas tabelas pelo cliente é negada.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

E2E criar/reabrir; SQL transação, raiz única, autoria e acesso cruzado. Medir query da biblioteca sem payload de nós.

## Limites desta entrega

Não antecipar geração IA, reordenação ou CRUD de projetos.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

### Banco — migração `20261019152522_maps_and_nodes`
- `maps` (workspace, título 1–120, owner/created_by/updated_by, revision, deleted_at), `nodes` (FK composta `(map_id,parent_id)` → `(map_id,id)`, texto 1–500, source manual/ai, sort_order) e `map_operations` (id = operationId, actor, editor_session_id, kind, revisões, request_hash, before/after gerados no servidor).
- Uma raiz por mapa: índice único parcial (no máximo uma) + constraint triggers adiados em `maps` e `nodes` (pelo menos uma ao fim da transação, inclusive para service_role).
- RLS: `maps`/`nodes` só SELECT para membros ativos do workspace (mapas com `deleted_at` ficam invisíveis); `map_operations` sem grants nem políticas para clientes (aviso INFO do advisor é intencional). Nenhum INSERT/UPDATE/DELETE para anon/authenticated.
- `public.create_map` (SECURITY INVOKER) → `private.create_map` (SECURITY DEFINER, search_path vazio): exige auth.uid e vínculo ativo, autoria/responsável da sessão, insere mapa + raiz "Ideia central" + operação numa transação; lock consultivo por operationId; mesmo id + mesmo pedido devolve o resultado anterior; outro conteúdo ou outro autor → `CONFLICT`. Erros tipados no message.
- `public.get_map_document` (SECURITY INVOKER, uma instrução = um snapshot): mapa + nós com a mesma revisão; mapa alheio e inexistente devolvem `null` igualmente.
- Teste SQL com rollback como o admin real: criação idempotente, raiz e título corretos; contagens voltaram a zero.
- Tipos regenerados do projeto.

### Interface
- `/mapas`: biblioteca só com colunas do mapa e nome do responsável (sem nós), estado vazio, botão "Novo mapa". operationId estável na tela: reenviar após falha repete a mesma operação. Lista em linhas no desktop e cartões no mobile.
- `/mapas/:mapId`: loader no bundle principal valida o UUID e carrega o documento; canvas React Flow (chunk lazy) mostra a raiz com layout d3 horizontal provisório (medição de alturas fica no ticket 07). Mapa inacessível/inexistente/ID inválido → "Mapa indisponível"; falha de serviço → erro recuperável.
- Nós com token próprio `--node-radius`, escala neutra; arestas em cinza funcional.

### Verificações locais
| Verificação | Resultado |
| --- | --- |
| `tsc --noEmit`, `eslint` | Passaram. |
| `vitest run` | 12/12 (novos: mapeamento de erros, layout). |
| `npm run build` / `test:bundle` | Passaram. Principal 670 kB (197 kB gzip) porque o build com `.env.local` agora inclui supabase-js (sem configuração ele era eliminado); editor 188 kB lazy. |
| Smoke público | 15/15. |
| `test:rls` (+6 testes de mapas) e `test:e2e:auth` (+1 fluxo B cria / A reabre / C sem acesso, desktop e mobile) | Ver "Validação real". |


### Validação real

Executada pelo agente com `npm run test:integration`, lendo `MAPA_PROJECT_REF` e a chave secreta de `.env.validation` (permissão 600, decisão do usuário em 19/10/2026; o arquivo não foi lido nem exibido).

| Suíte | Resultado |
| --- | --- |
| `test:rls` | **13/13**: os 7 de acesso do ticket 02 e 6 de mapas (B cria em X e fica responsável, A abre o mesmo documento com raiz "Ideia central" de autoria de B; mesmo operationId não duplica, outro conteúdo ou outro autor → CONFLICT; C e D não leem nem criam em X (FORBIDDEN), anon não chama as RPCs; insert/update diretos em maps/nodes e leitura do log negados; mapa sem raiz, segunda raiz e remoção da raiz falham mesmo com service_role; biblioteca sem payload de nós). |
| `test:e2e:auth` | **16/16** (14 do ticket 02 + fluxo de mapas em desktop e mobile): B cria e é levado ao editor, recarregar mantém mapa/raiz/responsável, A vê o item com responsável B e abre, C vê biblioteca vazia e "Mapa indisponível" no link direto; a biblioteca aberta não pede nós nem documentos. |
| Repetição do fluxo de mapas | **8/8** (`--repeat-each=4`, desktop e mobile). |

**Falha intermitente encontrada e corrigida.** Nas primeiras execuções, o fluxo travava às vezes em "Carregando página… / Verificando acesso…" logo após "Novo mapa" (logs do projeto: numa vez só o OPTIONS do `create_map` chegou; noutra o POST deu 200 e a navegação ao editor parou). Instrumentação mostrou que o Supabase reemite `SIGNED_IN` para o mesmo usuário ao carregar a página/recuperar sessão, e `src/auth/events.ts` tratava todo evento como troca de identidade: bloqueava a tela, limpava o cache e revalidava no meio da ação. Agora só troca real de conta ou saída (e restauração do bfcache) bloqueia e limpa; mesmo usuário, foco e retorno à aba apenas revalidam, e só com o roteador ocioso. Teste unitário `identityChanged` adicionado; troca A→C e logout do ticket 02 continuam passando.

Outros ajustes: canvas ocupa as 12 colunas no desktop (regra do grid tinha prioridade); verificação de "biblioteca sem nós" passou a observar só o período com a biblioteca aberta (antes contava a navegação ao editor iniciada pelo clique).

- Limpeza conferida no banco após as execuções: 1 conta, equipe CNVT, 1 vínculo, 0 mapas/nós/operações; `.validation-runs/` vazio.
- Capturas em [evidence/05](../evidence/05) (biblioteca de B e A, editor criado e recarregado, mapa indisponível para C; desktop e mobile), inspecionadas.
- Checks finais: tsc, eslint, vitest 13/13, build, test:bundle e smoke público 15/15.
- Limites: layout provisório sem medição de altura (ticket 07); Chromium com emulação mobile, sem Safari/aparelho físico.

Próximo na sequência recomendada: **06** (criar e editar nós).
