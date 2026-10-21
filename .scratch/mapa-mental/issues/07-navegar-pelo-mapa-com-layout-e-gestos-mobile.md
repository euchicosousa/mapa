# 07: Navegar pelo mapa com layout e gestos mobile

**What to build:** Uma árvore com vários ramos se organiza sem sobreposição e pode ser explorada por mouse ou toque.

**Blocked by:** 06: Criar e editar nós com autoria e salvamento

**Status:** done — implementado e verificado em 19 de outubro de 2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Implementar layout d3-hierarchy horizontal com largura fixa e alturas medidas, conforme contrato. Conexões derivam de parent_id, nunca de cópia independente de relacionamentos.
2. Preservar viewport ao editar; Enquadrar é ação explícita e abertura inicial pode enquadrar. Novo filho deve ficar acessível sem saltos bruscos.
3. Configurar pan de fundo, pinça e botões de zoom. Nós não arrastam livremente. Seleção por toque e painel inferior no mobile; impedir gesto do canvas em inputs/painel.
4. Usar dvh/safe areas, painel rolável e controles visíveis com teclado virtual. Recalcular layout só em alterações relevantes, usando memoização e seletores restritos.

## Critérios de aceite

- [x] Árvore com 50 nós e textos longos não apresenta sobreposição após layout estabilizar.
- [x] Pinça, pan, seleção e edição por toque funcionam; canvas não captura scroll do painel.
- [x] Zoom permanece ao editar texto; Enquadrar mostra todos os ramos visíveis.
- [x] 390×844 e 768 px permitem editar com teclado virtual sem perder botão de concluir.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Playwright viewport/touch e teste manual em navegador mobile disponível; registrar limites de emulação. Testar layout com alturas diferentes.

## Limites desta entrega

A regra de cantos retos do shell não obriga o formato dos nós. Usar token de raio independente no componente do nó; pílulas são permitidas. Preservar um padrão simples nesta entrega, sem seletor nem persistência de personalização de formas, que ficam para depois.

Sem drag-and-drop estrutural, mini-mapa obrigatório ou renderização de milhares de nós.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

### Entrega — 19 de outubro de 2026

- Layout horizontal d3.tree: largura de 240 px, colunas de 320 px, alturas reais obtidas por ResizeObserver e separação vertical mínima de 32 px. Texto completo, sem o limite visual provisório de três linhas. Raio próprio dos nós preservado.
- Layout memoizado por documento/alterações confirmadas localmente e medições; seleção e pan/zoom não refazem a árvore. O painel responde a cada tecla; o canvas recebe o texto no commit lógico de 650 ms/blur, sem aguardar o servidor.
- Abertura enquadra uma vez após medição. Edição mantém a transformação da viewport. Novo filho recebe apenas a translação necessária, mantendo zoom. Enquadrar explícito reserva 72 px acima para não esconder os primeiros nós sob os controles; afastamento até 0,1% permite enquadrar árvores altas.
- Fundo arrastável por mouse/toque; trackpad com pan; pinça e botões +/−/Enquadrar com alvos de 44 px. Sem reposicionamento livre ou alteração estrutural por arraste. Conexões continuam derivadas de parentId.
- Painel inferior abaixo de 768 px e lateral a partir de 768 px. Conteúdo rolável separado das ações, dvh/safe areas e altura ajustada via visualViewport. Texto de campo com 16 px. Rolagem do campo/painel não transforma o canvas.

### Verificações e resultados

- `npm run typecheck`: passou.
- `npm run lint`: passou, sem avisos.
- `npm test`: **23/23**, incluindo 50 nós com alturas diferentes e mudança posterior de alturas; separação entre irmãos, primos e nós internos; revelação mínima de filho sem mudar escala.
- `npm run build`: passou. Permanecem os avisos anteriores de comentário PURE do Zod e chunk principal acima de 500 kB (680,01 kB; editor 194,75 kB); otimização de escala permanece no ticket 24.
- `npm run test:bundle`: fronteira pública passou nos dois cenários (configuração pública válida e chave privilegiada recusada).
- `npm run test:e2e:auth -- tests/auth/canvas.spec.ts tests/auth/nodes.spec.ts`: **6/6**, execução `20261019-0b4e37`, recursos temporários removidos. Regressão inclui autoria entre duas contas, rascunho inválido preservado, fila de edição, resposta perdida e retry idempotente.
- Após reforçar todos os 49 ramos para textos de 312–465 caracteres, `npm run test:e2e:auth -- tests/auth/canvas.spec.ts`: **4/4**, execução final `20261019-dedc50`, recursos temporários removidos. Cada cenário roda em 1440×900 e 390×844 com toque. Os testes verificam caixas de 50 nós sem interseção, enquadramento dentro do canvas e abaixo da barra, transformação preservada ao editar e zoom preservado ao adicionar filho.
- Gestos mobile verificados por eventos touch reais do Chromium/CDP: arraste de fundo muda viewport; pinça muda percentual de zoom; toque seleciona e edita; rolagem touch do textarea muda scrollTop e mantém transformação do canvas. Espaço de teclado simulado reduzindo viewport para 390×420 e 768×420: botão Concluir edição integralmente visível, edição concluída e sem overflow horizontal.
- Capturas revisadas e preservadas em [evidence/07](../evidence/07). `50-nodes-fit.png`, `50-nodes-edit.png`, `navigation-edit.png` e `keyboard-space-390/768.png` nos diretórios desktop/mobile correspondentes.
- SQL somente leitura na conta **Primary**, projeto `bodxafqkqlyfoyfgahyj`, após a limpeza: workspaces **1**, memberships **1**, profiles **1**, maps **1**, nodes **2**, operations **2**, usuários de validação **0**. Igual à base anterior. `.validation-runs` sem execuções pendentes. Sem migração, reset ou alteração de configuração remota.

### Ajustes durante a validação

O primeiro preparo usava alguns textos acima de 500 caracteres; corrigido no teste, preservando a validação real do servidor. A regressão anterior dependia de reenquadramento automático para tocar em um ancestral distante; passou a usar Enquadrar explicitamente. Esperas de Auth/carregamento remoto excederam o padrão de cinco segundos em duas tentativas; a suíte autenticada usa agora 15 segundos por asserção e a regressão composta 60 segundos, sem retries automáticos. A revisão visual identificou nós sob a barra no topo: corrigido com padding assimétrico e asserção específica. Todos esses caminhos foram revalidados.

### Limites e continuidade

Emulação Chromium com toque e redução de espaço disponível não equivalem a teclado do iOS/Android ou Safari em aparelho físico; essa verificação física não foi realizada. Não há configuração externa pendente para este ticket. Não houve deploy. Preferências persistidas de visualização pertencem ao ticket 12; reorganizar ramos pertence ao 11. O próximo na sequência recomendada é **08**, ainda não iniciado.

Referências consultadas: [React Flow — propriedades e gestos](https://reactflow.dev/api-reference/react-flow), [React Flow — performance](https://reactflow.dev/learn/advanced-use/performance), [d3.tree](https://d3js.org/d3-hierarchy/tree), além dos tipos das versões instaladas.

**Resultado final: done.**
