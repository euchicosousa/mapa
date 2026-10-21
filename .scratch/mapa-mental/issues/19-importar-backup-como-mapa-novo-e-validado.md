# 19: Importar backup como mapa novo e validado

**What to build:** Reabrir um backup cria um mapa independente, e arquivos inválidos não alteram nada.

**Blocked by:** 18: Exportar um backup portátil do mapa; 16: Duplicar mapas para explorar outra direção

**Status:** done — implementado e verificado em 20 de outubro de 2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Selecionar arquivo JSON, verificar tamanho antes de leitura e validar schema version 1, ids únicos, raiz única, pais existentes, ciclos, limites e profundidade. Rejeitar formato/versão desconhecidos com mensagem clara.
2. Enviar estrutura sem confiar autoria/provenance. Servidor repete validação e cria mapa+todos os nós em transação usando a primitiva de cópia.
3. Atribuir responsável/criador atuais e source=manual; ids sempre novos. Arquivo não escolhe workspace ou owner.
4. Limitar memória e tempo; entrada 2 MB/500 nós; confirmação só resume título/quantidade, sem editor de migração. Adaptar recuperação de rascunho à mesma primitiva, mantendo contrato explícito.

## Critérios de aceite

- [x] Exportar/importar preserva texto e relações, com nova autoria e ids.
- [x] Ciclo, pai ausente, duas raízes, versão desconhecida e arquivo grande são recusados sem gravação parcial.
- [x] Payload direto na API também é validado.
- [x] Duplo envio com mesmo operationId cria apenas um mapa.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Fixtures boas/ruins, SQL rollback e E2E upload em mobile/desktop.

## Limites desta entrega

Sem importação de ferramentas externas ou HTML. Proveniência não concede identidade.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Execução em 20/10/2026, Primary `bodxafqkqlyfoyfgahyj`.

- **Entrega:** Biblioteca → Importar backup, seleção nativa limitada antes da leitura a 2 MiB, JSON UTF-8 estrito, formato/schema v1 compartilhado com exportação, leitura até 10 s. Confirmação resume título/quantidade e abre novo mapa após sucesso. Validações/clientes não executam HTML ou atribuem autoria por arquivo. Falha mantém biblioteca e seleção; pedido idempotente sobrevive à resposta perdida e, com reseleção do mesmo arquivo, à recarga. Armazenamento da aba guarda só operationId+SHA-256, por conta/equipe, nunca conteúdo. Fonte de erro e nova seleção explícitas.
- **Servidor:** `import_map_backup` deriva a equipe do único vínculo ativo e trava o vínculo antes de gravar/repetir. Arquivo não escolhe equipe/projeto/owner; título, árvore e textos são validados novamente. IDs novos, responsáveis/autores do solicitante, source=manual, projeto/histórico/preferências vazios, operação import_map sem dependência de origem. `private.insert_map_copy` compartilhada com duplicação e recuperação, com validador integral privado. Nenhum write direto concedido. Importação preserva texto/relações/ordem lógica; índices por pai são normalizados para 0… para evitar overflow em adição posterior. Desempate pelo UUID antigo. A recuperação local mantém seu contrato e hash anteriores.
- **Migrações:** `20261020145943_import_portable_backup.sql` e `20261020150900_normalize_import_order.sql`, criadas pelo CLI, dry-run e aplicação uma vez no Primary, sem editar migrações aplicadas. API pública invoker e implementação privada definer com search_path vazio; validador/primitiva sem execute para authenticated/anon. Tipos reais gerados. A segunda migração normaliza índices válidos muito altos, detectados na revisão final, para manter o mapa importado editável.
- **Verificações:** typecheck/lint, 78 testes unitários/12 arquivos, build/bundle aprovados. Suíte completa 46/46 integrações reais após primeira migração (incluindo regressão de 08/16); 3/3 cenários de importação revalidados após normalização, incluindo adicionar irmão depois de índice 2147483647. E2E inicial 11/12: somente overflow de campo nativo em 360 px; corrigido com largura limitada, sem redesign. Repetição 6/6 após correção; final após normalização 6/6 em 1440×900 e 390×844, com checagem 360. Exportação regressiva 6/6 na primeira rodada. Roundtrip nativo, autoria/nova URL/IDs, edição independente, arquivos inválidos sem requests, duplo clique, resposta perdida/recarga/reseleção e uma única cópia verificados. Logs/capturas/JSON em [resultados.json](../evidence/19/resultados.json).
- **Conferência/limpeza:** 20 migrações locais/remotas conciliadas, privilégios e hash das funções em backend-proof.json; nenhuma escrita direta nova. Contagens finais originais: 1 workspace/vínculo/perfil/mapa, 2 nós/operações, 0 projetos/preferências; nenhum usuário ou registro de validação restante. Advisors finais sem novos achados; avisos prévios registrados com links de remediação em evidence/19/advisors-*-final.json.
- **Escopo:** UI preservada conforme pedido do usuário; apenas controles de importação e correção de largura funcional. Sem deploy, formatos externos, HTML ou redesign. Proveniência não suportada no v1 estrito e nunca usada como autorização. Configurações de SMTP/IA permanecem para fases seguintes. Guia de formato/importação em docs/BACKUP.md; prioridade funcional registrada nos READMEs.

Status final: **done**, manifesto sincronizado. Total 16/28 concluídos, 12 restantes. Próxima fase recomendada: 03 → 04 → 15 (SMTP necessário para e-mails reais); 20–22 exigem a configuração de IA. Nenhum desses tickets foi iniciado nesta execução.
