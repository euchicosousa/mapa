# 14: Transferir responsabilidade sem restringir a edição

**What to build:** Responsável ou administrador transfere um mapa para outro membro ativo, mantendo autoria histórica.

**Blocked by:** 05: Criar um mapa com responsável e reabri-lo

**Status:** done — verificado no Primary, desktop e mobile em 20/10/2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Exibir responsável no editor/biblioteca e seletor apenas para responsável atual/admin. Adicionar comando transfer_owner com revisão e registro de alteração.
2. Servidor valida ator, membro destino ativo na mesma equipe e mapa ativo. Autor original do mapa não muda. Todos os membros ativos continuam editando.
3. Atividade concorrente usa CONFLICT padrão, nunca atualiza owner com escrita direta. Identidade desativada permanece legível em autoria.
4. Teste permite membro comum editar conteúdo mas negar transferência de mapa que não é seu.

## Critérios de aceite

- [x] B transfere mapa próprio para A; created_by continua B.
- [x] Admin transfere mapa de outro membro; membro comum não consegue.
- [x] Destino de outra equipe ou inativo é rejeitado.
- [x] Transferência não retira edição dos demais membros.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Testes SQL de matriz responsável/admin/membro/externo; E2E seletor mobile.

## Limites desta entrega

Não adicionar permissões individuais por mapa; owner é responsabilidade com poderes específicos.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Executado em **20/10/2026**, no projeto final **Primary / bodxafqkqlyfoyfgahyj**. Bloqueador 05 conferido. Sem Docker, staging, outro banco ou dados simulados no produto.

### Entrega

- Em **Detalhes do mapa**, responsável atual e administrador encontram o seletor de outro membro ativo da equipe. Colegas veem o responsável e continuam editando, sem o seletor de transferência. Cabeçalho e biblioteca mostram o novo responsável após confirmação canônica.
- Comando `transfer_owner` com payload mínimo `{ownerId}`, revisão esperada, idempotência e registro de antes/depois no servidor. Mapas ativos somente; destino precisa estar ativo na mesma equipe. Locks do mapa e dos vínculos serializam a transferência e protegem as verificações até o commit.
- Autor original do mapa, nós, autoria e fonte permanecem intactos; `updated_by` identifica o ator. Uma repetição legítima retorna o resultado anterior mesmo depois de o ator deixar de ser responsável, sem uma nova transferência. Revogação de vínculo continua bloqueando acesso.
- A transferência constitui barreira do histórico de sessão, já compatível com a validação de tipos não reversíveis do servidor: a pilha local é limpa com explicação, e não se pode recuperar responsabilidade por Desfazer. Novas edições de conteúdo continuam reversíveis normalmente. A interface explica esse comportamento antes de transferir.
- A fila existente preserva a solicitação enviada e repete o mesmo ID/revisão/payload após resposta perdida, inclusive por recarga. Uma transferência definitivamente negada por papel/destino não revoga o acesso de conteúdo do colega e preserva edições locais posteriores. Concorrência usa o fluxo CONFLICT existente.
- Migração **20261020025706_transfer_map_owner.sql**, criada pela CLI, revisada, dry-run com apenas ela pendente e aplicada uma vez no Primary. Reutiliza `apply_map_command`; wrappers públicos continuam SECURITY INVOKER, funções privilegiadas privadas com search_path vazio e autorização explícita. Sem grants de escrita direta ou leitura de logs ao cliente. Tipos gerados do mesmo projeto; 14 versões locais/remotas conciliadas.

### Verificações

- `npm run typecheck`, `npm run lint`: passaram.
- `npm test`: **61/61**, 11 arquivos, incluindo patch canônico de responsável, barreira do histórico, edição após transferência, negativa sem revogação/perda da fila e retry idêntico com leitura de cabeça.
- `npm run test:rls`: **36/36 reais**. Matriz responsável/admin/membro/externo/anon; destino inativo, alheio, inexistente e atual; autoria imutável; edição por A/B/terceiro colega; identidade histórica inativa legível; escrita direta e recuperação por undo negadas; duas transferências concorrentes na mesma revisão produzem um commit e um CONFLICT.
- `npm run test:e2e:auth -- tests/auth/ownership.spec.ts`: execução final **4/4**, desktop **1440×900** e mobile **390×844**, também sem overflow em 360 px. Responsável e admin transferem; seletor autorizado e membros ativos; ex-responsável continua editando; biblioteca/URL refletem o destino; resposta real confirmada e abortada é recuperada após reload por solicitação idêntica, mantendo uma única revisão adicional.
- Regressão da biblioteca no conjunto combinado: **2/2**, os dois tamanhos, com 45 mapas/projetos/filtros/ordem de respostas.
- Histórico dos testes preservado: a primeira suíte de transferência ficou 2/4 porque o teste conferia opções antes de concluída a consulta; a espera foi corrigida. O conjunto combinado posterior ficou 5/6 por uma falha pontual de salvamento mobile depois de alternar contextos; cenário isolado passou e a suíte final passou 4/4, sem falhas RPC registradas. Não se atribui causa não observada a essa falha anterior.
- `npm run build` e `npm run test:bundle`: passaram. Principal **768,44 kB**, editor **216,08 kB**. Avisos preexistentes de anotações Zod e chunk >500 kB permanecem para otimização no 24.
- Advisors sem novos achados. Permanecem INFO intencional de `map_operations` sem política/grants de cliente, WARN de proteção de senhas vazadas desativada e avisos de desempenho anteriores.
- Limpeza final comprovada: **1 workspace, 1 vínculo, 1 perfil, 1 mapa, 2 nós, 2 operações, 0 preferências, 0 projetos e 0 usuários de validação**. Diretório de registros temporários vazio. Dados reais anteriores preservados.

### Evidências e limites

[Resultados](../evidence/14/resultados.json), [catálogo e contagens](../evidence/14/backend-proof.json), [segurança](../evidence/14/security-advisors.json), [desempenho](../evidence/14/performance-advisors.json), capturas [desktop](../evidence/14/desktop/) e [mobile](../evidence/14/mobile/). Uso e comportamento do histórico em `docs/BIBLIOTECA.md`.

Sem permissões individuais por mapa, desativação de membros, exclusão de mapas ou tempo real. Destinos e papel são revalidados no servidor mesmo quando uma tela antiga ainda mostra um seletor. Nenhuma configuração externa faltante. Sem deploy e sem iniciar outro ticket.

Referências conferidas: [funções e privilégios Supabase](https://supabase.com/docs/guides/database/functions), [changelog oficial](https://supabase.com/changelog.md), [alteração TLS publicada em 12/10](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) sem exigir mudança nos clientes atuais desta entrega.

**Status final: done. Total: 12/28 concluídos, 16 restantes. Próximo na sequência recomendada: 17.**
