# 12: Recolher ramos e lembrar a visualização por pessoa

**What to build:** A pessoa concentra o mapa e retoma seu zoom/ramos recolhidos sem alterar a visualização dos colegas.

**Blocked by:** 07: Navegar pelo mapa com layout e gestos mobile

**Status:** done — critérios verificados; resultados e evidências abaixo.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Criar preferências por usuário/mapa com RLS própria. Persistir viewport/collapsed ids com debounce separado de operações do conteúdo.
2. Botão recolher/expandir mostra quantidade de descendentes ocultos. Retirar descendentes ocultos do conjunto renderizado e conexões correspondentes; preservar no documento.
3. Descartar ids inexistentes ao carregar preferências. Ao recolher ancestral de nó selecionado, selecionar ancestral. Ao abrir mapa novo sem preferências, enquadrar.
4. Falha de preferência não marca conteúdo como não salvo nem altera revision.

## Critérios de aceite

- [x] Recolher e reabrir mantém todos os nós no banco e recupera estado visual.
- [x] A e B têm zoom/ramos independentes no mesmo mapa.
- [x] Nó oculto não permanece no DOM/foco; contador de descendentes correto.
- [x] Usuário não escreve preferência alheia via API.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; nenhuma infraestrutura ausente nesta execução.

## Como verificar

E2E duas contas e reload; RLS preferência; contar elementos renderizados antes/depois.

## Limites desta entrega

Preferências não entram no histórico de conteúdo nem no backup do mapa.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

### Entrega

- **Recolher/expandir** disponível no painel e no controle lateral de cada nó com filhos. O corpo do nó continua selecionando com um clique/toque; o controle separado tem 44×44 CSS px antes da transformação do canvas, rótulo acessível e aria-expanded. O painel oferece o equivalente por toque sem depender do tamanho do zoom. Nós recolhidos mostram a quantidade total de descendentes ocultos.
- A projeção de visibilidade remove descendentes e arestas correspondentes do React Flow/DOM/foco, preservando o documento completo, os IDs, textos, autoria e ordem. IDs recolhidos de ramos internos permanecem ao recolher/expandir um ancestral. Recolher ancestral do selecionado devolve a seleção ao ancestral. Texto inválido não é abandonado; adicionar filho a pai recolhido o expande. Mudança estrutural/histórico reposiciona seleção num ancestral visível quando necessário.
- Viewport e collapsed_node_ids ficam no Supabase por **map_id/user_id**. Leitura/gravação isoladas do protocolo de conteúdo, da fila, do IndexedDB de rascunhos e das pilhas de undo/redo. Sem alteração em maps.revision, autores ou map_operations. Sem preferências no backup/cópia de conteúdo. Estado do cliente instanciado por conta/mapa e componente com chave de ambas as identidades.
- Preferências com debounce de **600 ms**, uma gravação em voo e preservação da versão local mais recente. Pan/zoom são capturados ao terminar o gesto; escrita também é solicitada ao sair da rota, ocultar a página ou pagehide. Um gesto novo não é apagado pela confirmação anterior. Sem retry automático infinito; falha tem mensagem e ação próprias, mantendo o conteúdo editável e seu indicador Salvo independente.
- Ao abrir, carregar preferência antes do canvas; aplicar viewport após medir os nós visíveis. Na ausência de preferência, enquadrar. O ajuste inicial não grava um viewport sintético nem regrava ao selecionar um nó. Preferências não são reenquadradas por editar/mover/reordenar. IDs inexistentes/repetidos são limpos, e a preferência normalizada é salva separadamente. Falha de leitura usa visualização local e não sobrescreve a preferência remota; tentativa explícita reconcilia a leitura, preservando gestos locais feitos após a falha.

### Banco, autorização e fontes

Migração **20261020015620_map_user_preferences.sql**, criada pela CLI, revisada e aplicada uma vez ao projeto final **bodxafqkqlyfoyfgahyj**, conta **Primary**, após dry-run listar somente ela. Migrações anteriores preservadas; sem Docker, banco local, staging ou reset. Tipos TypeScript regenerados do projeto remoto.

Tabela pública com PK (map_id,user_id), FKs para mapas/perfis com cascade das preferências, índice por usuário e RLS própria. Grants removidos de PUBLIC/anon; authenticated usa SELECT/INSERT/UPDATE/DELETE limitados pela mesma regra USING/WITH CHECK: auth.uid próprio e membro ativo de mapa não excluído. Preferências alheias não ficam visíveis nem a um administrador da equipe. Nenhum privilégio de escrita em mapas/nós/logs foi alterado. Helper privado SECURITY INVOKER/IMMUTABLE valida exatamente x/y/zoom numéricos (zoom 0,001…2, coordenadas finitas limitadas a ±10⁹). Lista de UUIDs unidimensional, sem nulos, até 500 entradas; cliente também valida com Zod.

Skill Supabase aplicada. Consultadas as referências oficiais de [RLS/grants/USING/WITH CHECK](https://supabase.com/docs/guides/database/postgres/row-level-security) e [React Flow/viewport](https://reactflow.dev/api-reference/react-flow), além dos tipos das versões instaladas. A skill diagnosing-bugs orientou o isolamento dos problemas de preparo/seleção durante a validação.

Advisors de segurança sem achado novo; permanecem o INFO intencional do [log sem política/grant cliente](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) e o WARN anterior de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Resultado preservado em [security-advisors.json](../evidence/12/security-advisors.json).

### Verificações

- Typecheck/lint: passaram.
- `npm test -- --pool=threads --maxWorkers=1`: **54/54**, 10 arquivos. Projeção de ramos aninhados, contagem/seleção, limpeza de IDs, separação por conta/mapa, debounce, serialização, confirmação antiga, falha/retry, leitura falha sem sobrescrever remoto, gestos locais preservados e saída/retorno tardio de leitura.
- `npm run test:rls`: **30/30**, Auth/banco Primary reais. Regressão de 09/10/11; preferências independentes A/B com gravações concorrentes, documento/revisão/log intactos; leitura/gravação/remoção alheias, reassignment de user_id, mapas externos, anon/sem vínculo/vínculo revogado/mapa excluído, viewport inválido e lista nula/excessiva rejeitados sem alterar os dados anteriores.
- Aceite de interface na versão final: `npm run test:e2e:auth -- tests/auth/preferences.spec.ts tests/auth/canvas.spec.ts --grep 'personal collapse|preference read/write|50 real nodes|pan, touch|moves a branch|undo and redo controls'`: **11/12**, execução **20261020-342061**, limpa. Os **8/8** de regressão passaram: 50 nós medidos/sem sobreposição, gestos/pinça/scroll, teclado reduzido, história e movimento em desktop/mobile. Os dois de falha de preferência também passaram (conteúdo segue salvando enquanto GET/POST da preferência são abortados no teste; retry volta à persistência real). Um teste de duas contas no mobile não acionou expandir ao retornar à janela de origem; o teste passou a ativá-la explicitamente antes do toque.
- Revalidação final de duas contas/viewport/recolhimento: `npm run test:e2e:auth -- tests/auth/preferences.spec.ts --grep 'personal collapse'`: **2/2**, execução **20261020-4252ff**, limpa. Corpo do nó seleciona sem recolher, ancestral substitui seleção oculta, contador/DOM/arestas corretos, pan/zoom comparados com a linha realmente gravada, A/B com preferências independentes, reload recupera viewport/IDs, UUID inexistente descartado, expandir recupera os cinco nós e quatro conexões, documento/revisão/autoria permanecem exatamente iguais. Esses resultados são combinados com a rodada anterior; não se afirma uma rodada única 12/12.
- `npm run build` e `npm run test:bundle`: passaram. Avisos preexistentes de Zod/PURE e chunk acima de 500 kB; principal **746,71 kB**, editor **210,52 kB**. Otimização permanece no ticket 24.

### Ajustes identificados na validação

A primeira rodada de preferências (**20261020-c450fc**, limpa) teve **2/4**: o preparo criou um mapa mas a navegação ao editor não ocorreu, sem pedido de leitura do documento; outro cenário dependia de tocar num texto pequeno para escolher um nó que não era necessário à checagem de falha de preferências. O preparo passou a usar create_map/get_map_document reais com a conta autenticada e abrir explicitamente a URL do mapa; o teste de falha edita o nó selecionado pelo painel. Não se atribuiu causa à navegação sem evidência nem se alterou Auth/criação nesta fatia. A rodada seguinte de preferências passou **4/4**, execução **20261020-207b2a**, limpa.

A regressão do canvas (**20261020-07795e**, limpa) passou **6/8** e identificou o novo botão ocupando o centro dos nós, interceptando cliques destinados à seleção. O controle foi reposicionado na lateral; o corpo seleciona e o botão recolhe/expande. O teste de preferências passou a afirmar a seleção pelo centro sem recolher o ramo, além de verificar persistência do pan comparando a transformação real com a linha salva no banco. Não foram usados dados simulados no produto: falhas de rede são induzidas abortando somente a chamada real de preferência no teste.

### Evidências e limites

Capturas de desktop 1440×900 e mobile 390×844 em [evidence/12](../evidence/12), com preferência de cada colega, retorno da visualização e conteúdo salvo durante falha de preferência. [Resultados estruturados](../evidence/12/resultados.json) e [prova remota](../evidence/12/backend-proof.json).

Conferência remota após as limpezas: **1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações, 0 preferências e 0 usuários temporários**. Base anterior preservada; `.validation-runs` vazio. Histórico remoto coincide com as **12 migrações locais**; RLS habilitada, grants anônimos removidos e política própria USING/WITH CHECK conferida.

Chromium emulado; sem Safari ou aparelho físico. A gravação de preferências requer rede: fechar a aba antes da confirmação pode perder a última preferência visual. Não há offline integral nem promessa de gravação após encerrar o processo. As preferências são por pessoa/mapa; múltiplas abas da mesma pessoa usam a última gravação confirmada. Sem configuração externa pendente para esta fatia, sem deploy. Ticket 13 não iniciado.

**Resultado final: done.**
