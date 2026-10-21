# 11: Mover ramos e ordenar irmãos por controles acessíveis

**What to build:** Reorganizar um ramo pelo menu mantém filhos, autoria e capacidade de desfazer.

**Blocked by:** 07: Navegar pelo mapa com layout e gestos mobile; 10: Desfazer e refazer alterações próprias

**Status:** done — critérios verificados; resultados e evidências abaixo.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Adicionar move_subtree e reorder_siblings ao protocolo com ordem inteira determinística. Mudança de pai recalcula ordem dos dois grupos na mesma transação.
2. Menu Mover mostra possíveis pais pesquisáveis e exclui próprio nó/descendentes. Botões subir/descer alteram ordem entre irmãos, inclusive no celular.
3. Servidor também impede ciclo, raiz movida, pai de outro mapa e limite de profundidade. UI não é a única validação.
4. Estender snapshots/histórico para desfazer/refazer ambas as operações. Recalcular layout e preservar seleção/viewport.

## Critérios de aceite

- [x] Mover ramo leva todos os descendentes e preserva created_by.
- [x] Subir/descer funciona nos limites sem produzir ordem ambígua.
- [x] Tentativas de ciclo, mover raiz e pai externo falham atomicamente.
- [x] Undo/redo recupera pai e ordem anteriores.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; nenhuma infraestrutura ausente nesta execução.

## Como verificar

Testes de domínio e transação com ciclos e reordenação; E2E ação completa por toque.

## Limites desta entrega

Arrastar ramo não é necessário nesta versão; menu é o mecanismo oficial.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

### Entrega — 19 de outubro de 2026

- Painel do nó oferece **Mover**, **Subir** e **Descer**. Mover abre diálogo com busca por texto/caminho (inclui busca sem acentos), opções de pai por rádio e cancelamento. O próprio nó, os descendentes e o pai atual não aparecem; destinos acima de 30 níveis ficam desabilitados. O ramo entra como último filho. Caminho dos ancestrais distingue textos repetidos. Raiz não recebe controles estruturais.
- Subir/Descer mostram a posição entre irmãos; primeiro/último ficam desabilitados no respectivo limite. Seleção e transformação do canvas permanecem; o layout horizontal e as conexões são recalculados a partir de parentId/sortOrder. Controles por toque e campos de 16 px, diálogo/painel roláveis, alvos de pelo menos 44 px. Campos continuam com comportamento nativo de teclado. Fechar por Cancelar/Escape devolve o foco ao botão Mover, pelo evento de encerramento do diálogo.
- `move_subtree {nodeId,newParentId,targetIndex}` e `reorder_siblings {nodeId,targetIndex}` usam o protocolo comum, revisão esperada, operação idempotente, bloqueio por mapa e vínculo ativo. targetIndex é o índice inteiro a partir de zero na lista final de destino. Ordem determinística por sort_order/id; os dois grupos são normalizados para 0…n−1 atomicamente. Movimento para o mesmo pai também respeita essa convenção.
- Servidor recusa campos desconhecidos, índices inválidos, pai/nó de outro mapa, raiz, ciclos e profundidade acima de 30 considerando o descendente mais profundo. Erros não alteram nós, revisão nem log. Todos os membros ativos podem reorganizar; criadores, source e relações internas do ramo permanecem. Somente os registros cuja posição/pai muda recebem o editor atual.
- Histórico estendido às duas operações: snapshots de ambos os grupos vêm do servidor, sem dados de autoria enviados pelo browser. Undo/redo restaura pai, ordem e último editor originais; preserva criadores e os descendentes. As duas ações seguem as pilhas próprias e a barreira externa existentes. Fila, projeção imediata e IndexedDB reconhecem ambos os comandos; recuperação repete operação/revisão/sessão imutáveis antes do próximo comando.

### Banco

Conta **Primary**, projeto final `bodxafqkqlyfoyfgahyj`. Migrações criadas com a CLI e aplicadas após cada dry-run confirmar somente o arquivo pendente:

1. `20261019225919_move_subtree_and_reorder_siblings.sql`: comandos estruturais e extensão do histórico.
2. `20261019230317_qualify_structural_depth.sql`: qualifica `walk.depth` para evitar colisão com a variável preexistente de profundidade.

A checagem E2E ampliada identificou que o foco era devolvido antes do encerramento do modal; corrigido usando onCloseAutoFocus do Radix, sem mudar os diálogos existentes que não fornecem callback de foco.

A primeira rodada integrada passou nos 26 testes existentes e revelou a colisão de nome nos dois novos cenários. As transações foram revertidas; a migração aplicada foi preservada e a correção registrada separadamente. Após a correção, **28/28** passaram, incluindo movimento com autoria mista e netos, normalização dos dois grupos com lacunas, idempotência, múltiplos undo/redo e rejeições atômicas de raiz/ciclo/pai externo/índice/profundidade/autorização.

Wrapper público continua SECURITY INVOKER e implementação privada SECURITY DEFINER com search_path vazio; sem novos grants/tabelas/endpoints. Assinaturas RPC e tipos públicos não mudaram. Sem Docker, staging, reset ou deploy. Skill Supabase aplicada, documentação oficial de [funções](https://supabase.com/docs/guides/database/functions) e changelog consultados; nada exigiu alteração das APIs instaladas.

Advisors de segurança sem achado novo: permanecem o INFO intencional de [log sem política cliente](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), que também não tem grant cliente, e o WARN anterior de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### Verificações e limites

- `npm run typecheck`, `npm run lint`: passaram.
- `npm test -- --pool=threads --maxWorkers=1`: **46/46**, 8 arquivos. Inclui normalização dos dois grupos, índices/bordas, autoria, ciclo/raiz/pai externo/profundidade, fila de movimentos/reordenação, seleção preservada, desfazer/refazer local e recuperação do pedido estrutural exato no IndexedDB.
- `npm run test:rls`: **28/28**, Auth/banco Primary reais. Regressão integral de 09/10 e os cenários estruturais descritos acima. Sem testes ignorados.
- `npm run test:e2e:auth -- tests/auth/canvas.spec.ts`: **15/16**, execução **20261019-c90fd4**, limpa. Uma falha de entrada da conta temporária antes de abrir o mapa, sem mensagem de erro no formulário; não foi atribuída uma causa sem evidência. Os outros 15 fluxos passaram, incluindo os dois do ticket 11, árvore de 50 nós e histórico/recuperação em ambos os tamanhos.
- Revalidação de pan/toque/teclado e exclusão em ambos os tamanhos passou **4/4** nas rodadas seguintes; última **20261019-af913a**, limpa. O fluxo novo ampliado detectou retorno de foco antecipado (corrigido), uma preparação em que o filho estava sob a raiz (o teste agora aguarda seleção do painel e confere o pai inicial), e uma asserção de viewport que exigia 100% apesar de apenas **0,125 px** de arredondamento. A checagem usa agora razão mínima de 0,99; não foram alteradas regras de produto para satisfazê-la.
- Aceite final ampliado: `npm run test:e2e:auth -- tests/auth/canvas.spec.ts --grep 'moves a branch'`: **2/2**, execução **20261019-b57e11**, limpa. Em **1440×900** e **390×844**, por mouse/toque: busca sem acentos, opções válidas, cancelamento sem revisão, foco devolvido ao botão, ramo de três níveis preservado, subida/descida e limites, múltiplos undo/redo com snapshots exatos, seleção/transformação mantidas, persistência após reload. Espaço de teclado reduzido para **768×420** e **390×420**: Concluir e Cancelar alcançáveis, busca recebe foco, Escape fecha, sem overflow horizontal.
- `npm run build` e `npm run test:bundle`: passaram, incluindo chave privilegiada recusada no bundle público. Avisos existentes do Zod/PURE e chunk principal acima de 500 kB permanecem; principal **746,63 kB**, editor **204,31 kB**. Otimização fica no ticket 24.
- Capturas revisadas em [evidence/11](../evidence/11), com busca do pai, ramo movido, histórico/ordem e diálogo em espaço reduzido. Resultados estruturados em [resultados.json](../evidence/11/resultados.json), migrações/grants/contadores conferidos em [backend-proof.json](../evidence/11/backend-proof.json).

Conferência remota após todas as limpezas: **1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações e 0 usuários temporários**. Igual à base anterior; dados reais preservados. `.validation-runs` vazio. Histórico remoto coincide com as 11 migrações locais; comandos e histórico estruturais instalados, escrita cliente e leitura do log continuam negadas.

Sem configuração externa pendente. Chromium emulado com mouse/toque e viewport reduzida, sem Safari ou aparelho físico. Não há arraste estrutural nesta entrega; o mecanismo oficial é o painel. Ticket 12 permanece não iniciado.

**Resultado final: done.**
