# Revisão do andamento — 19 de outubro de 2026

Escopo: conferir registros, implementação e ambiente atual; não iniciar outro ticket, modificar código de produto ou executar testes que criem/alterem dados remotos.

## Estado confirmado

Manifesto e status dos arquivos concordam: **01, 02, 05 e 06 done**. Todos os bloqueadores desses tickets estão concluídos. Demais 24 tickets estão ready-for-agent, mas esse estado não significa dependências satisfeitas.

| Ticket | Entrega registrada e código presente |
| --- | --- |
| 01 | Shell Swiss responsivo, rotas, configuração e marca SVG MA/PA |
| 02 | Login Supabase, sessão, equipe e isolamento |
| 05 | Biblioteca, criação/reabertura de mapa e raiz, responsável |
| 06 | Filho/neto, edição de texto, autoria, fila serial, retry idempotente e indicadores de salvamento |

Decisão atual substitui a antiga exigência de Docker: um único projeto Supabase final, inclusive para desenvolvimento, com validações delimitadas e limpeza por IDs. Confirmado pelo conector **Primary**: projeto mapa, ref bodxafqkqlyfoyfgahyj, organização korjwhxxmmojlfbbwqfm, região sa-east-1, estado ACTIVE_HEALTHY.

Histórico remoto corresponde aos três arquivos locais:

1. 20261019140900_identity_and_workspaces
2. 20261019152522_maps_and_nodes
3. 20261019161731_node_commands

Consulta somente de contagens: 1 espaço, 1 vínculo, 1 perfil, 1 mapa, 2 nós e 2 operações. Zero contas com prefixo de validação; .validation-runs vazio. Os dados existentes foram preservados; não se assume que o mapa seja descartável.

## Verificações desta revisão

- `npm run typecheck`: passou.
- `npm run lint`: passou.
- `npm test`: **18/18** em 6 arquivos.
- `npm run build`: passou. Principal 679,93 kB (200,29 kB gzip); editor lazy 192,26 kB. Aviso de tamanho do chunk principal e comentários PURE do Zod, sem falha de build.
- `npm run test:e2e`: **15/15**, smoke público em desktop 1440×900, mobile 390×844 e 360×800.
- Relatório HTML autenticado preexistente inspecionado por metadados: **18 esperados/18 aprovados, zero falhas, flaky ou skipped**. Os registros do ticket 06 informam também RLS 18/18 e repetição do fluxo de nós 4/4. **Não executei novamente Auth/RLS contra o banco nesta revisão**; o relatório anterior não equivale a um novo teste ponta a ponta.
- Inspeção remota somente leitura: projeto, migrações, advisors, contagens e privilégios.

Não foram lidos/exibidos segredos de .env.validation nem executadas criações/limpezas remotas.

## Problema reproduzido: perda de texto inválido ao trocar de nó

Prioridade: corrigir antes da próxima funcionalidade (ajuste do ticket 06).

Em `src/state/editor.ts:144`, `typeText` tenta concluir o rascunho de outro nó e depois substitui o único campo `draft`. Entretanto, `commitText` retorna imediatamente quando o texto é inválido. Isso permite perder um texto acima de 500 caracteres sem decisão explícita de descarte.

Reprodução em memória, com envio de teste e sem servidor real:

1. Carregar documento com raiz e um filho.
2. Digitar 501 caracteres na raiz.
3. Selecionar o filho e começar a editar seu texto.
4. O rascunho passa a pertencer ao filho; o texto da raiz volta ao confirmado, perdendo os 501 caracteres.

O teste existente de texto inválido verifica apenas permanecer no mesmo nó. Falta cobrir troca de seleção/novo filho e início de outra edição. Recomendo preservar rascunhos por nó ou impedir a transição com mensagem/decisão explícita, mantendo o texto até sua correção ou descarte confirmado. Isso é independente da persistência em IndexedDB do ticket 08.

## Pendências e limites já previstos

- Layout usa ROW_HEIGHT fixo de 120, sem altura medida; estrutura nova chama fitView automaticamente. São os pontos do ticket 07, não conclusão antecipada desse ticket.
- Rascunhos/fila estão só em memória; conflito pausa mas não oferece resolução. Recuperação após reload/offline, cópia e descarte controlado pertencem ao 08.
- Recuperação de senha (03) e convites (04) continuam pendentes. Precisam de envio de e-mail real, redirects e caixa autorizada; a disponibilidade atual do SMTP não foi verificada nesta revisão.
- Sem publicação funcional completa nem IA integrada. O projeto remoto já existe; isso não conclui os tickets de publicação.

## Organização e segurança

O README da raiz ficou desatualizado: omite 06 no resumo, conserva contagens de testes do 02, afirma que mapas/editor estão indisponíveis e que não houve alteração remota. Os registros específicos e o tracker refletem melhor a implementação. Recomendo atualizar antes de outro repasse de agente.

O diretório não é repositório Git. Recomendo criar um histórico de versão da base atual antes de acumular novas alterações. Nenhuma configuração Git foi criada nesta revisão.

Advisors remotos:

- INFO em map_operations com RLS sem política: intencional segundo a migração. Conferido diretamente que anon/authenticated não têm SELECT no log e authenticated não tem UPDATE em maps/nodes. [Explicação do aviso](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- WARN: proteção contra senhas vazadas está desativada no Auth. Verificar suporte/configuração do plano e tratar antes de abrir acesso mais amplo. Não foi alterada nesta revisão. [Orientação do Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Caminho recomendado

1. Corrigir a perda de texto inválido do 06 e acrescentar regressão; atualizar documentação e registrar a base em Git.
2. Executar **07**, isoladamente: altura medida, árvore de 50 nós sem sobreposição, preservação de zoom, controles visíveis, pan/pinça e painel com teclado virtual.
3. Executar **08**, isoladamente: rascunho persistente e recuperação de conflitos. Prioritário antes do uso cotidiano com conteúdo importante.
4. Seguir 09–12 e gestão de mapas; antecipar 03→04 quando o envio real de e-mail estiver pronto, respeitando bloqueadores.

Tickets executáveis por dependência hoje: **03, 07, 08, 09, 13, 14 e 18**. A ordem recomendada do tracker privilegia o núcleo 07→08→09→10→11→12. SMTP não bloqueia esse núcleo. Nenhum ticket novo foi iniciado ou teve seu status alterado por esta revisão.


## Retorno após a revisão — ajuste concluído

O usuário autorizou executar o ponto 1 (perda de texto inválido). Correção concluída no ticket 06: transição bloqueada enquanto o texto não for corrigido, aviso acessível e foco no campo, sem sobrescrever o rascunho. Regressões passaram (20/20 unitários e fluxo autenticado de nós 2/2 em desktop/mobile), recursos temporários removidos e dados reais preservados. Ver o registro “Ajuste de preservação de texto inválido” no ticket 06 para comandos e capturas. Os achados acima permanecem como histórico da revisão; esse defeito específico está resolvido. Ticket 07 não iniciado. README/Git e demais recomendações não foram tratados nessa correção restrita.


## Atualização — ticket 07 concluído

Após autorização do usuário, implementado somente o 07: alturas medidas, texto completo, navegação por mouse/trackpad/toque/pinça, controles explícitos e painel responsivo com ações acessíveis em espaço reduzido de teclado. Unitários 23/23; fluxo autenticado canvas+nós 6/6 e cenário reforçado final de canvas 4/4, em desktop/mobile. Evidências e limites registrados no ticket 07. Limpeza confirmada no Supabase Primary: 1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações e nenhum usuário temporário. README atualizado; Git permanece ausente. A revisão acima é histórica. Estado atual: 01, 02, 05, 06 e 07 done; próximo recomendado 08, não iniciado.


## Atualização — ticket 08 concluído

Executado somente o 08 após autorização: IndexedDB isolado, replay de pedido durável, recuperação após reautenticação, conflito com cópia atômica e descarte confirmado, proteção de navegação/logout e limpeza por conta/mapa. Migração 20261019184928_recover_local_map aplicada na Primary e tipos regenerados. Unitários 31/31, RLS 21/21, smoke público 15/15 e bundle/build passaram. Suíte autenticada integral 35/38, com três falhas de sincronização nos testes corrigidas e revalidadas em 4/4; o ticket registra a combinação das evidências, sem afirmar rodada integral 38/38. Todos os critérios foram verificados em desktop/mobile. Limpeza final mantém os mesmos 1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós e 2 operações; nenhum usuário temporário. Estado atual: 01, 02, 05, 06, 07 e 08 done. Próximo recomendado 09, não iniciado.


## Atualização — ticket 09 concluído

Após autorização do usuário, executado somente o 09. A transação comum agora remove um ramo não raiz inteiro, registra antes os nós/autoria lidos pelo servidor e mantém revisão/idempotência. A interface informa descendentes, confirma ramos, permite remoção direta de folhas e seleciona o pai. Migração `20261019202703_delete_node_subtree` aplicada na Primary; autorização e grants revisados. Unitários 33/33, RLS real 22/22, E2E autenticado desktop/mobile 2/2 (`20261019-3937a8`), lint/typecheck/build aprovados. O teste autenticado cobre confirmação cancelada sem mudança de revisão, exclusão do ramo com irmão preservado e exclusão direta de folha. Evidências, limites e falhas de teste corrigidas durante a rodada constam no ticket 09. Limpeza final: 1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações e zero usuários temporários. Estado atual: 01, 02, 05, 06, 07, 08 e 09 done; próximo desbloqueado 10, ainda não iniciado.


## Atualização — ticket 10 concluído e 09 revalidado

Executado somente o 10 e a revalidação solicitada do 09. Desfazer/refazer usa snapshots confiáveis do servidor, pilhas de até 100 ações próprias, ordem validada, barreira entre sessões, invalidação de redo e replay com autorização atual. Pedidos e intenção de desfazer em voo são duráveis; falhas pausam novas edições até reconciliar. Botões e atalhos do canvas preservam os atalhos nativos dos campos. Quatro migrações do 10 aplicadas na Primary; histórico local/remoto conferido. A última foi aplicada via CLI remota após expiração do conector e dry-run delimitado.

Verificações finais: typecheck/lint/build/bundle aprovados; unitários **42/42**; Auth/RLS real **26/26**; E2E autenticado **10/10** em desktop/mobile, execução `20261019-66248b`, limpa. Revalidação do 09 inclui cancelamento sem revisão, ramo de três níveis sem órfãos, irmão preservado, seleção do pai e exclusão direta de folha; undo/redo recupera os IDs e autores originais. Falhas intermediárias e correções estão registradas no ticket 10, assim como evidências. Sem achado novo de segurança nos advisors. Limpeza final confirmada: 1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações e nenhum usuário temporário. Estado atual: **01, 02, 05, 06, 07, 08, 09 e 10 done**. Próximo recomendado **11**, ainda não iniciado.


## Atualização — ticket 11 concluído

Executado somente o 11: Mover com busca/caminho do novo pai, Subir/Descer com limites visíveis, ramo inteiro preservado e ordem normalizada dos dois grupos na mesma transação. Criadores/source preservados; servidor recusa raiz, ciclos, pais externos, índices inválidos e profundidade acima de 30. Undo/redo usa snapshots confiáveis dos grupos, com fila/recuperação idempotente existentes. Seleção e viewport mantidas. Duas migrações versionadas aplicadas e conferidas no Supabase Primary; uma correção de alias de profundidade foi registrada após a rodada inicial.

Typecheck/lint/build/bundle aprovados; unitários **46/46**, Auth/RLS **28/28**. Regressão completa do canvas **15/16** (`20261019-c90fd4`): falha antes de abrir o mapa no login temporário; o cenário de navegação foi revalidado nos dois tamanhos. Rodadas ampliadas corrigiram retorno de foco do diálogo, sincronização da preparação e tolerância de arredondamento subpixel. Navegação/teclado/exclusão revalidados **4/4** na última rodada composta; aceite final do movimento/ordem/histórico/foco/espaço reduzido **2/2**, desktop/mobile, execução **20261019-b57e11**, limpa. O registro detalhado não afirma uma rodada completa 16/16. Evidências em evidence/11.

Contadores finais: 1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações e nenhum usuário temporário. Sem configuração externa pendente para o 11, sem deploy e sem teste em aparelho físico/Safari. Estado atual: **01, 02, 05, 06, 07, 08, 09, 10 e 11 done**; próximo recomendado **12**, não iniciado.


## Atualização — ticket 12 concluído

Executado somente o 12: recolher/expandir pelo painel e controle lateral, contador completo de ocultos, retirada de descendentes/arestas do DOM mantendo conteúdo, seleção devolvida ao ancestral, viewport e ramos por pessoa/mapa no Supabase. RLS própria impede acesso/gravação alheia e exige vínculo ativo/mapa não excluído. Debounce/serialização/retry separados de conteúdo; falha de preferência não altera Salvo/revisão/autoria/histórico e mantém edição disponível. IDs inexistentes limpos e novos mapas enquadrados. Migração `20261020015620_map_user_preferences` aplicada na Primary; tipos remotos regenerados, histórico/grants/advisors conferidos.

Typecheck/lint/build/bundle aprovados; unitários **54/54**, Auth/RLS real **30/30**. Rodada final de interface **11/12**, execução `20261020-342061`, limpa: **8/8** regressões do canvas/histórico/movimento e **2/2** falhas de preferência, mais fluxo pessoal desktop. O caso pessoal mobile exigiu ativar a janela de origem após trocar entre duas contas; revalidação final dos dois tamanhos **2/2**, execução `20261020-4252ff`, limpa. Não se afirma uma rodada única 12/12. Ajustes anteriores de preparo e do botão central interceptando seleção estão no ticket. Controle lateral preserva clique/toque no corpo do nó. Evidências revisadas em evidence/12.

Contadores após limpeza: 1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações, 0 preferências e nenhum usuário temporário. Sem configuração externa pendente para o 12, sem deploy/Safari/aparelho físico. Estado atual: **01, 02, 05, 06, 07, 08, 09, 10, 11 e 12 done**; próximo recomendado **13**, não iniciado.
