# 06: Criar e editar nós com autoria e salvamento

**What to build:** Adicionar filhos e editar texto mostra resposta imediata, salva e mantém a autoria original.

**Blocked by:** 05: Criar um mapa com responsável e reabri-lo

**Status:** done — entrega e ajuste de rascunho inválido verificados; 20 testes unitários e fluxo de nós com regressão 2/2 em desktop/mobile.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Implementar add_child e edit_text pela transação comum. Client gera id estável para filho; servidor valida unicidade, pai, limite e calcula autoria/ordem. Não aceitar created_by/source pelo payload.
2. Zustand guarda documento ativo e fila serial. Atualização visual imediata, coalescência de texto 650 ms/blur e uma escrita em voo. Salvo só quando não houver pendências nem requisição ativa.
3. Botões Adicionar filho/Editar no painel responsivo; mostrar criador e último editor. Texto puro com limites e erro de validação sem perda do digitado.
4. Na falha, reter operação e oferecer tentar novamente com mesmo id. Conflito pausa a fila e avisa, sem sobrescrever documento local; recuperação completa vem no ticket 08.

## Critérios de aceite

- [x] Criar filho e neto, editar e recarregar preserva árvore e textos.
- [x] A edita nó de B: created_by continua B e updated_by vira A.
- [x] Duas edições rápidas não trocam ordem nem marcam Salvo prematuramente.
- [x] Repetição após timeout não duplica nó; autor/source falsificados são rejeitados.
- [x] Ação por toque funciona em 390 px sem hover ou teclado físico.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

E2E com duas contas; testes de fila com resposta atrasada, erro e retry; testes de payload forjado no banco.

## Limites desta entrega

Não implementar merge automático, posição livre ou colaboração ao vivo.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

### Banco — migração `20261019161731_node_commands`
Aplicada pelo conector Supabase no projeto `mapa` (`bodxafqkqlyfoyfgahyj`); arquivo local renomeado para a versão registrada; `list_migrations` mostra as três migrações. Advisors de segurança: só os avisos já conhecidos (`map_operations` sem políticas, intencional; proteção de senha vazada no Auth).
- `public.apply_map_command(p_map_id, p_operation_id, p_editor_session_id, p_expected_revision, p_kind, p_payload)` (SECURITY INVOKER) → `private.apply_map_command` (SECURITY DEFINER, search_path vazio, EXECUTE só para authenticated). Ordem do contrato: auth.uid → lock consultivo do operationId → lock da linha do mapa (mapa alheio/inexistente/excluído = `NOT_FOUND`) → repetição (mesmo id, autor, mapa e hash devolve o resultado gravado; outro conteúdo/autor → `CONFLICT`) → `expectedRevision` (diferente → `CONFLICT`) → validação → aplicação → revisão +1 → log com before/after gerados no servidor.
- `add_child {nodeId, parentId, text}`: id do cliente único (reuso → `VALIDATION`, nunca upsert), pai precisa existir no mesmo mapa, `sort_order` = último irmão + 1, limites 500 nós e profundidade 30 (raiz = 0) → `LIMIT_EXCEEDED`. `edit_text {nodeId, text}`: muda texto e `updated_by`, preserva `created_by`/`source`. Texto puro 1–500, não em branco, sem truncar. Campos desconhecidos (createdBy, created_by, source, updatedBy, sortOrder) e comandos desconhecidos → `VALIDATION`. Autor e `source=manual` vêm sempre do servidor.
- Resposta canônica: `operationId, revision, changedNodes (registro completo), deletedNodeIds, mapPatch`.
- `get_map_document` (create or replace) passa a incluir `people` (nome de responsável, criadores e últimos editores, via RLS de perfis).
- Tipos regenerados pelo conector (`generate_typescript_types`): só entrou `apply_map_command` em `Functions`.

### Interface e estado
- `src/state/editor.ts` (Zustand): documento confirmado + fila + rascunho; a tela mostra sempre confirmado + fila + rascunho (resposta imediata). Uma escrita em voo por mapa, em ordem; texto coalescido após 650 ms sem digitar ou no blur; edição ainda não enviada do mesmo nó é fundida, enviada nunca muda. Operações estruturais aguardam o texto anterior. "Salvo" só sem fila, sem rascunho e sem requisição. Falha mantém a operação na cabeça com o mesmo id e oferece "Tentar novamente"; `CONFLICT` pausa a fila e avisa, sem sobrescrever o documento local (recuperação no 08). Refetch nunca substitui documento com pendências nem com revisão mais antiga. Timeout de 20 s por requisição.
- Editor: painel lateral (desktop, colunas 10–12) e painel inferior em fluxo abaixo do canvas (mobile, rola o mínimo para aparecer após tocar um nó). Toque seleciona; botões "Editar texto", "Adicionar filho" e "Concluir edição" (44 px). Mostra "Criado por … · Última edição por …" ("você" para a própria conta). Texto inválido fica no campo com aviso e contador, nunca é enviado; "Concluir edição" desabilitado (borda tracejada). Indicador Salvo/Alterações pendentes/Salvando…/Falha ao salvar/Conflito com `role=status` e ícone, monocromático. Nó selecionado por contorno espesso; texto do nó limitado a 3 linhas no canvas (texto completo no painel). Sair com pendências pede confirmação (navegação interna e fechar aba).
- Ajustes: `ROW_HEIGHT` provisório 96 → 120 (nós de 3 linhas); medição real fica no 07. Seletores do spec do 05 passaram a olhar a raiz dentro do canvas (o texto também aparece no painel).

**Defeito encontrado e corrigido durante a validação:** a primeira versão da fila chamava `window.clearTimeout` desvinculado (`timers.clearTimeout(...)`), o que lança "Illegal invocation" no navegador; como `reset()` do editor roda em toda troca de sessão, o login inteiro caía na página de erro (todos os e2e falharam; jsdom não acusa). Os timers padrão agora envolvem as globais.

### Verificações
| Verificação | Resultado |
| --- | --- |
| `tsc --noEmit`, `eslint` | Passaram. |
| `vitest run` | 18/18 (5 novos de fila: ordem e uma escrita em voo; coalescência 650 ms e duas edições rápidas com resposta atrasada sem "Salvo" prematuro; falha com resposta perdida e retry com o mesmo id sem duplicar; conflito pausa e refetch não sobrescreve; texto inválido nunca enviado). |
| `npm run build` / `test:bundle` | Passaram. Principal 680 kB (200 kB gzip); editor 192 kB lazy. |
| Smoke público (`npx playwright test`) | 15/15. |
| `npm run test:integration` (agente, `.env.validation` sem ler/exibir) | `test:rls` **18/18**: os 13 anteriores + B cria filho e neto e A edita o nó de B (created_by B, updated_by A, árvore/textos/nomes ao recarregar, log com before_data); retry com mesmo id devolve o mesmo resultado sem duplicar, revisão +1, outro conteúdo/autor e revisão antiga → CONFLICT; autor/source/campos/comando forjados e texto inválido → VALIDATION, nada aplicado; C/D → NOT_FOUND, anon negado, update direto negado; profundidade 31 → LIMIT_EXCEEDED. `test:e2e:auth` **18/18**: os 16 anteriores + fluxo de nós em desktop e mobile (B cria filho e neto por toque no mobile, texto inválido mantido, recarregar preserva; A abre, vê "Criado por B · Última edição por B", edita, vê "Última edição por você" também após recarregar; duas edições com servidor atrasado 1,5 s chegam em ordem e "Salvo" só no fim; resposta perdida após commit → "Falha ao salvar" → "Tentar novamente" reenvia o mesmo operationId e o mapa fica com 4 nós). |
| Repetição do fluxo de nós | 4/4 (`--repeat-each=2`, desktop e mobile). |

- Banco conferido após os testes (conector): 1 conta, equipe CNVT, 1 vínculo admin ativo, 1 perfil, 0 mapas/nós/operações, nenhuma conta `mapa-validacao-*`; `.validation-runs/` vazio.
- Capturas em [evidence/06](../evidence/06), inspecionadas: árvore de B, validação, edição de A, salvando e falha/retry, desktop 1440×900 e mobile 390×844.
- Limites: sem IndexedDB/rascunho persistente nem resolução de conflito (08); layout ainda sem medição de altura (07); atalhos de teclado ficam para 23; Chromium com emulação mobile, sem Safari/aparelho físico.

Próximo na sequência recomendada: **07** (navegar pelo mapa com layout e gestos mobile).


## Ajuste de preservação de texto inválido — 19 de outubro de 2026

Solicitado pelo usuário após a revisão do andamento. Escopo restrito a impedir a perda de texto inválido ao trocar de nó/iniciar outra edição ou criar filho; ticket 07 não iniciado.

### Causa e correção

O editor tem um rascunho ativo. `commitText` preservava corretamente texto inválido, porém `select`, `addChild` e `typeText` de outro nó prosseguiam como se a conclusão tivesse funcionado. A nova edição substituía o rascunho anterior.

Adotada a menor correção compatível com o estado atual: enquanto o rascunho não for válido, bloquear a transição, sem truncar, descartar ou enviar o texto. `select` retorna false mantendo a seleção; `addChild` retorna null sem criar nó/operação; `typeText` de outro nó não substitui o rascunho. Depois de corrigir o mesmo texto, a conclusão/fila/seleção funcionam normalmente.

Na interface, “Adicionar filho” fica desabilitado com descrição associada ao aviso de validação. O aviso orienta corrigir o texto antes de trocar de nó/adicionar filho; tentar selecionar outro nó devolve foco ao campo atual e mantém o painel acessível. Não houve mudança de banco, schema ou autorização, nem persistência de rascunho em IndexedDB (08).

### Verificações

- Aplicada a skill diagnosing-bugs. A reprodução em memória e a causa já tinham sido isoladas na revisão anterior; a investigação foi retomada a partir desse resultado, sem repetir hipóteses exploratórias.
- `npx vitest run src/state/editor.test.ts` **antes** da correção: 2 regressões falharam (texto em branco e texto de 501 caracteres), 5 testes anteriores passaram.
- Mesmo comando **depois**: 7/7 passaram. As novas regressões cobrem tentativa de trocar seleção, digitar diretamente em outro nó, criar filho, manter o rascunho e não enviar a alteração inválida; após corrigir o texto, salvar/trocar/criar voltam a funcionar.
- `npm test`: **20/20** em 6 arquivos.
- `npm run typecheck`, `npm run lint`, `npm run build`: passaram. Permanecem os avisos anteriores de tamanho do chunk principal e comentários PURE do Zod; nenhum erro de build.
- `npm run test:e2e:auth -- nodes.spec.ts`, execução final: **2/2** (desktop 1440×900 e mobile 390×844, toque). Cenário real preserva os 501 caracteres ao tentar selecionar outro nó, mantém “Alterações pendentes”, não cria nós extras, bloqueia adicionar filho e libera a seleção após corrigir. Também cobre os fluxos anteriores de autoria, recarga, fila atrasada e retry após resposta perdida.
- Na primeira execução, a regressão de preservação passou nos dois tamanhos; a asserção posterior de seleção no mobile falhou usando o mesmo alvo em dois toques próximos. O teste passou a tocar um alvo distinto após corrigir o texto, evitando ambiguidade com double-tap/zoom do canvas. Nenhum gesto do produto foi alterado nesta fatia. Executado mobile isolado (1/1), depois ambos juntos (2/2).

### Evidências e limpeza

- [Desktop — rascunho mantido](../evidence/06/ajuste-rascunho/desktop-rascunho-preservado.png).
- [Mobile — rascunho mantido](../evidence/06/ajuste-rascunho/mobile-rascunho-preservado.png).
- Capturas inspecionadas; Chromium com emulação mobile, sem alegar teste em aparelho físico/Safari.
- Testes reais usaram somente contas/espaços temporários identificados pelas execuções e limpos pelos scripts existentes. Execução final `20261019-487cd7` limpa; `.validation-runs` vazio.
- Conferência remota só de contagens após a limpeza: 1 espaço, 1 vínculo, 1 perfil, **1 mapa, 2 nós, 2 operações**, zero contas com prefixo de validação. Dados da equipe preservados.
- RLS e migrações não foram alterados; a suíte RLS completa não foi repetida para esta correção de estado/interface.

**Status final: done.** Manifesto sincronizado. Próximo recomendado continua sendo 07; não executado nesta retomada. O ajuste preserva texto durante a sessão; recuperação após fechar/recarregar com pendências continua no ticket 08.
