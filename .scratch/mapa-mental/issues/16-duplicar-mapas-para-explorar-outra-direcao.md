# 16: Duplicar mapas para explorar outra direção

**What to build:** Criar uma cópia independente de um mapa sem alterar o original.

**Blocked by:** 08: Recuperar rascunhos e resolver conflito sem perda

**Status:** done — implementado e verificado em 20 de outubro de 2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Reutilizar primitiva de criação de cópia do ticket 08, distinguindo duplicação remota de recuperação local. Duplicação remota lê snapshot coerente no servidor.
2. Gerar ids novos, remapear pais e manter texto/ordem/projeto. Responsável, criador de mapa/nós e updated_by passam a ser solicitante; source=manual. Guardar referência de origem apenas como informação, não autorização.
3. Título recebe “ — cópia”, respeitando limite. Transação idempotente evita duplicar por duplo clique.
4. Abrir nova URL após confirmação; falha mantém original selecionado e informa erro.

## Critérios de aceite

- [x] Cópia tem mesma estrutura/texto, ids novos e responsável solicitante.
- [x] Editar/excluir nó na cópia não muda original.
- [x] Repetir mesma operação retorna mesma cópia.
- [x] Copiar mapa alheio ao workspace é negado.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

E2E duplicação e independência; SQL remapeamento de pais e autoria.

## Limites desta entrega

Sem clonagem de histórico, jobs de IA ou preferências de outro usuário.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Execução em 20/10/2026 no projeto final Primary `bodxafqkqlyfoyfgahyj`.

- **Comportamento implementado:** Detalhes → Duplicar mapa, disponível a todo membro ativo após salvar. Confirmação abre a URL da cópia somente após resposta do servidor; cancelamento/falha preservam URL, seleção e conteúdo do original. Repetição pendente usa o mesmo ID, inclusive após recarga, com explicação quando o original mudou. Falha de armazenamento impede envio. Durante a solicitação, confirmação/fechamento ficam bloqueados; diálogos aninhados respeitam a ordem visual.
- **Servidor:** `duplicate_map` lê metadados e nós sob o mesmo lock dos comandos de edição. Reutiliza `private.insert_map_copy` também pelo fluxo existente `create_map_copy` do 08; valida árvore inteira (500 nós, profundidade 30), gera UUIDs, remapeia pais e grava mapa/nós/operação numa transação. Preserva projeto, texto e ordem; título até 120 caracteres com sufixo ` — cópia`. Responsável/created_by/updated_by vêm do solicitante, source=manual e ai_generation_id vazio. A origem está somente em `map_operations.before_data` (sourceMapId/sourceRevision), sem FK nem efeito de autorização.
- **Segurança/idempotência:** autorização e mapa ativo antes do replay; hash remoto depende da solicitação, não de mudanças posteriores na origem. Não clona histórico, jobs ou preferências. API pública invoker, implementação definer no schema privado com search_path vazio; primitiva interna sem EXECUTE para authenticated/anon. Nenhuma escrita direta foi concedida. Cópia continua acessível e editável após exclusão da origem.
- **Migrações:** `20261020133059_duplicate_remote_map.sql` e `20261020133607_validate_copy_snapshot.sql`, criadas pelo CLI, conferidas com dry-run e aplicadas uma vez no Primary; migrações anteriores preservadas. Tipos gerados do projeto real.
- **Verificações já concluídas:** typecheck, lint, 64 testes unitários/11 arquivos, build e fronteira pública do bundle; 43/43 testes reais de integração (incluindo regressão da recuperação local, autoria IA convertida em manual, remapeamento/projeto, edição/exclusão independentes, replay/conflito, membro de outra equipe/anon/revogado/excluído, concorrência e snapshot inválido sem dados parciais). Rodada final E2E 18/18 (6 duplicação, 2 biblioteca, 4 transferência, 6 exclusão), em 1440×900 e 390×844; checagem adicional de largura 360. Capturas revisadas nos dois tamanhos.
- **Histórico de validação:** primeira integração 41/42; um teste legado comparava log sem ORDER BY, corrigido para ordenar por ID; suíte completa posterior 43/43. E2E inicial 4/4. Rodada intermediária 15/16: worker mobile já em execução procurou o rótulo antigo depois da atualização de retomada; rodada reiniciada com testes atualizados. Resultados e logs intermediários preservados em `../evidence/16`.
- **Limites:** nenhuma configuração externa adicional necessária. Sem deploy e sem início do 18. Retomada depende dos dados da aba; não promete sobreviver a fechamento/limpeza da aba. Avisos anteriores de anotações PURE do Zod e chunk principal acima de 500 kB mantidos para o ticket 24. Advisors sem novos achados; avisos anteriores registrados com links em evidence/16/advisors-*.json.


- **Conferência final:** 18 migrações locais/remotas conciliadas; 0 usuários de validação e nenhum registro pendente em `.validation-runs`. Contagens originais mantidas: 1 workspace/vínculo/perfil/mapa, 2 nós/operações, 0 projetos/preferências. Advisors: mesmos avisos anteriores, sem novo achado. Evidências e histórico em [resultados.json](../evidence/16/resultados.json), [prova do backend](../evidence/16/backend-proof.json) e capturas desktop/mobile. Ticket/manifesto done; próximo recomendado 18, não iniciado.
