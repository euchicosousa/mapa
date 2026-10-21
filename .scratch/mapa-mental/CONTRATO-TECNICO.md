# Contrato técnico para execução

Estado: divisão e contrato aprovados pelo usuário em 19 de outubro de 2026; entradas externas continuam indicadas nas etapas correspondentes. Requisitos confirmados pelo usuário: SPA rápida, React Router, Supabase Auth e banco, equipe por turnos, responsável por mapa, autoria por nó, IA insere diretamente, desktop e mobile desde a primeira versão. O restante abaixo resolve escolhas de implementação; não representa configuração já realizada.

## 1. Stack e limites

React, TypeScript strict, Vite, React Router Data Mode, TanStack Query, Zustand, React Flow, d3-hierarchy para árvore horizontal, Tailwind CSS, Radix Dialog para modal/painel acessível, Zod para entradas. npm com versões exatas e lockfile. Vitest/Testing Library, Playwright e testes SQL/integração controlados no projeto Supabase final. Usar versões estáveis compatíveis verificadas na instalação; registrar runtime Node e versões escolhidas. Evitar canary/beta.

Banco PostgreSQL + Supabase Auth + Edge Functions. Vercel para SPA. OpenAI Responses API como provedor inicial proposto, isolado atrás de um adaptador; segredo OPENAI_API_KEY e modelo em AI_MODEL, configurados no servidor. A escolha exata do modelo depende de acesso, custo e suporte a saída estruturada; é entrada de configuração obrigatória, não decisão delegada silenciosamente ao executor. A integração deve funcionar com configuração válida e exibir indisponibilidade clara sem ela. Testes usam adaptador falso apenas no ambiente de teste. Nada de resultados simulados no produto publicado.

Sem tempo real, edição simultânea, billing, upload de imagens, chat, pesquisa na web pela IA, PWA/offline completo ou cadastro público. Um espaço de equipe por instalação na interface inicial; schema mantém workspace_id para isolamento. Autenticação por e-mail/senha via Supabase; Google não entra na primeira entrega. Nome provisório “Mapa”, interface pt-BR.

Limites iniciais de produto: título do mapa/projeto 120 caracteres; texto de nó 1–500; orientação IA até 1.000; mapa até 500 nós e profundidade 30; importação até 2 MB. Texto puro, sem HTML executável. Valores validados no cliente e servidor. Não truncar conteúdo digitado silenciosamente. Na IA, solicitar exatamente 4 filhos; se capacidade restante for menor que 4, bloquear e explicar.

## 2. Interface desktop e mobile

Todas as entregas têm aceite em 390×844 e 1440×900. Validação final também em 360 px e 768 px. Abaixo de 768 px: barra compacta, ações do nó em painel inferior, lista de mapas em cartões; acima: barra completa e painel lateral. Alvos de toque de pelo menos 44×44 CSS px, texto de campos pelo menos 16 px, viewport dinâmica (dvh), safe areas e teclado virtual considerados. Nenhuma ação essencial depende de hover, duplo clique, botão direito, arraste ou teclado físico.

Canvas: um toque seleciona; botão Editar abre texto; arrastar fundo move; pinça aproxima; botões +/−/Enquadrar sempre presentes. Nós não são reposicionados livremente: layout automático horizontal à direita. Reorganização por menu “Mover” e ações subir/descer entre irmãos. Nós com largura fixa de 240 px e altura medida pelo conteúdo; layout usa d3.tree com separação calculada a partir das alturas medidas e espaçamento horizontal de 320 px. Recalcular ao terminar edição/alterar estrutura, não a cada pan/zoom. Worker só se medição demonstrar necessidade. Aplicar a direção Swiss Design monocromática definida abaixo; sem animações de conexões; respeitar reduced-motion.

### Direção visual obrigatória — Swiss Design

Ajuste solicitado pelo usuário após a primeira implementação do ticket 01. Aplicar na base existente, antes de continuar as telas seguintes. Esta especificação substitui o tema anterior e sua cor de destaque.

- Paleta neutra nesta etapa: extremos papel `#fafafa` e tinta `#121212`, com cinzas intermediários acromáticos permitidos. Base de tokens: superfície secundária `#f0f0f0`, hover suave `#e6e6e6`, divisor decorativo `#d4d4d4`, borda funcional `#808080`, texto secundário `#666666`. Evitar branco/preto puros e matizes coloridos. Preferir esses tokens centralizados a misturas/opacidades avulsas.
- Tokens de fundo, superfície, texto, borda, foco e ação referenciam a escala neutra. Texto principal usa tinta; texto secundário usa #666666 sobre papel ou superfície secundária. Divisores claros servem apenas para decoração: limites de controles e foco precisam de contraste suficiente. Conferir cada combinação efetivamente usada; não reduzir legibilidade ao usar cinzas. Definir accent-color dos controles nativos com tinta e cobrir estados autorados de foco/seleção/hover. Não tentar personalizar interfaces do navegador/sistema operacional.
- Tipografia sem serifa: Helvetica Neue, Helvetica, Arial, sans-serif, sem download de fonte nesta etapa. Pesos 400 e 700; títulos com hierarquia forte, alinhamento à esquerda, entrelinha compacta; texto de leitura com entrelinha 1,5. Corpo 16 px; título principal responsivo de 32 a 64 px; rótulos de 12–14 px. Maiúsculas apenas em rótulos curtos.
- Composição por grid: 12 colunas no desktop e 4 no mobile, com alinhamentos compartilhados entre cabeçalho, conteúdo e rodapé. Margens de 24 px no mobile (16 px em 360 px se necessário), 48 px no desktop; espaçamento em múltiplos de 8 px. Hierarquia editorial, assimetria controlada e respiro; evitar conteúdo apresentado como uma pilha de cartões arredondados.
- Elementos da interface retos: radius 0 em painéis, cartões, campos e botões. Essa regra não define o formato dos nós do mapa. Usar linhas de 1 px com os tokens de borda/divisor adequados, espaços em branco e peso tipográfico para separar informações. Sem sombras, gradientes, texturas, vidro, decoração colorida ou logotipo serifado. Ícones simples monocromáticos. Círculos só quando a forma comunica um controle/ícone, não para decorar painéis.
- Botão principal: tinta com texto papel. Secundário: papel, borda/texto tinta. Hover/seleção podem usar superfície cinza, inverter papel/tinta ou acrescentar sublinhado/borda; estado ativo deve ser perceptível sem cor adicional. Foco visível com contorno sólido de 2 px e offset. Desabilitado usa borda tracejada e indicação textual/contextual, sem opacity; manter disabled/aria-disabled conforme o controle.
- Erro, aviso, sucesso, carregamento e configuração ausente permanecem monocromáticos, diferenciados por texto explícito, ícone e estrutura. Não introduzir paleta semântica nesta etapa. Preservar roles/aria-live adequados.
- Canvas, nós, arestas e indicadores personalizados seguem a mesma escala neutra. Seleção por espessura/contorno; geração IA por rótulo e destaque monocromático. Cores por mapa/ramo e futuras cores semânticas em tons neutros exigem etapa posterior; não escolher nem implementar essas cores agora.
- Forma dos nós: não impor cantos retos do shell ao componente de nó. Pílulas arredondadas são permitidas; a escolha final e o seletor de personalização do mapa ficam para depois. Quando o editor for construído, manter o raio dos nós em um token próprio, independente dos controles, preservando o padrão simples adotado nessa etapa. Não adicionar agora seletor, schema ou persistência de formatos. Uma futura troca de formato deve preservar IDs, relações e autoria e apenas recalcular dimensões/layout.
- Manter os requisitos mobile e de acessibilidade desta seção: áreas de toque 44 px, campos 16 px, safe areas, painéis e foco. Swiss Design não justifica reduzir legibilidade ou controles.

Verificação visual: capturar desktop 1440×900 e mobile 390×844, conferir também largura 360 px. Auditar cores autoradas em CSS, estilos inline, classes utilitárias e customizações de bibliotecas; validar a escala neutra centralizada, incluindo cinzas intermediários, e ausência de matizes coloridos; conferir contraste de texto, controles e foco. Verificar login, estado sem configuração, erro, carregamento, navegação ativa, 404 e foco. Comparar screenshots com a base anterior e registrar evidências novas; evidências anteriores não comprovam este ajuste.

Atalhos só com foco no canvas/nó: Tab cria filho, Enter cria irmão (na raiz cria filho), F2 edita, Delete remove ramo, Escape fecha editor/painel, Ctrl/Cmd+Z desfaz. Em input/textarea/contenteditable preservar teclas nativas; Escape pode cancelar edição explicitamente. Equivalentes visíveis por toque para tudo. O texto longo é editado no painel, sem expandir o nó por cima dos controles.

Rotas: /login, /recuperar-senha, /auth/callback, /definir-senha, /sem-acesso, /mapas, /mapas/:mapId, /equipe; / redireciona conforme sessão; rota desconhecida tem 404. Retorno após login aceita somente destino interno validado. Carregamento de sessão não exibe conteúdo privado. Router controla navegação; Query controla dados remotos; Zustand controla documento ativo, seleção, fila local e histórico. Refetch nunca substitui documento com operações pendentes.

## 3. Modelo e acesso

UUID em entidades; timestamps UTC no banco, apresentação local. Criar tabelas apenas quando a fatia precisar. Colunas:

- profiles: id FK auth.users, display_name, created_at; preservar identidade histórica. Perfil não contém papel autorizativo.
- workspaces: id, name, created_at.
- workspace_members: workspace_id, user_id, role (admin/member), status (active/inactive), unique composto.
- workspace_invitations: id, workspace_id, email normalizado, invited_by, auth_user_id opcional, status (pending/accepted/revoked), expires_at (7 dias), timestamps. Convite nunca depende de user_metadata editável.
- projects: id, workspace_id, name, client_name opcional, created_by, timestamps.
- maps: id, workspace_id, project_id nullable, title, owner_id, created_by, updated_by, revision bigint iniciando em 1, deleted_at nullable, timestamps.
- nodes: id, map_id, parent_id nullable, text, sort_order inteiro, created_by, updated_by, source (manual/ai), ai_generation_id nullable, timestamps. Uma raiz por mapa; raiz usa texto independente do título. FK composto (map_id,parent_id) impede pai de outro mapa, com unique (map_id,id). Validar ciclos, existência de raiz, profundidade e limite em todas as mutações.
- map_operations: id UUID da operação, map_id, actor_id, editor_session_id, kind, base_revision, result_revision, request_hash, before_data/after_data gerados pelo servidor, timestamp, referência de operação desfeita quando aplicável. Registro não editável pelo cliente.
- map_user_preferences: map_id,user_id, viewport e collapsed_node_ids. Escrita só pelo próprio usuário autorizado, não muda revisão do conteúdo.
- ai_generations: id, map_id,parent_node_id,requested_by,editor_session_id,request_hash,context_fingerprint,state,model,usage,reserved_tokens,created_at,finished_at,expires_at,applied_operation_id e resultado validado temporário; state pending/running/applied/failed/cancelled/stale. Resultado temporário descartado após aplicação/falha; metadados mantidos para idempotência.

Todo membro ativo pode ler, criar, editar e duplicar mapas/nós da equipe. Responsável ou administrador pode transferir responsabilidade e excluir mapa; membros podem excluir nós. Todo mapa novo pertence ao solicitante. Transferência exige destino ativo da mesma equipe. Administrador gerencia convites e membros; impedir desativar último administrador e desativar responsável enquanto possuir mapas ativos. Desativação é soft, não exclusão do usuário Auth. Autoria é imutável e obtida da sessão, nunca aceita do payload. updated_by muda ao editar. Nó IA usa requested_by como criador + source=ai. Importação/duplicação criam nós com autoria do solicitante e source=manual; proveniência importada, se exibida, é apenas informação externa.

## 4. Fronteira de segurança e mutações

RLS em todas as tabelas expostas. SELECT verifica vínculo ativo ao workspace do recurso; preferências, convites e logs têm escopo mais restrito. Evitar política recursiva em workspace_members: helper de verificação em schema privado, search_path fixo e nome qualificado. Perfis visíveis só a colegas da mesma equipe, com dados mínimos. Perfil de membro inativo permanece identificável para autoria.

Escritas de mapas/nós/operações/membros não são permitidas diretamente aos papéis anon/authenticated. Usar RPCs públicas SECURITY INVOKER como entradas finitas; quando privilégios elevados forem necessários, delegar a funções SECURITY DEFINER em schema privado não exposto, com grants EXECUTE específicos, search_path fixo, checagem explícita auth.uid e vínculo/papel em cada operação. Revogar EXECUTE de PUBLIC/anon; conceder somente as funções necessárias. Registrar e testar esse uso intencional de privilégio. Tabelas privadas/auxiliares sem exposição desnecessária. Nunca usar service_role no browser. Funções exclusivas do worker IA têm EXECUTE somente para serviço; worker identifica solicitante a partir do job criado por usuário autenticado, não de actor_id arbitrário.

Contrato de comando: mapId, operationId UUID, editorSessionId UUID, expectedRevision, tipo e payload mínimo. Resposta: revisão nova e patch canônico. Erros tipados: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION, CONFLICT, LIMIT_EXCEEDED. Mensagem pública não revela existência de mapa alheio.

Dentro de uma transação: validar acesso → bloquear linha do mapa → verificar operação repetida (mesmo id e mesmo request_hash retorna resultado anterior; conteúdo diferente falha) → verificar expectedRevision → validar operação → aplicar todas as alterações → incrementar revisão uma vez → registrar operação e patch → confirmar. Retry após timeout usa o mesmo id e payload, nunca transforma retry em nova edição. Não manter transação aberta durante chamada ao modelo. A operação idempotente pode retornar resultado anterior com revisão antiga; cliente refaz leitura de cabeça antes de comandos posteriores se necessário.

Catálogo de comandos do documento (nomes estáveis entre cliente e servidor):

| Comando | Payload específico | Efeito |
| --- | --- | --- |
| add_child | nodeId, parentId, text | Acrescenta último filho; sort_order calculado no servidor |
| edit_text | nodeId, text | Altera texto, preserva criador |
| delete_subtree | nodeId | Remove ramo inteiro, preserva snapshot servidor |
| move_subtree | nodeId, newParentId, targetIndex | Move ramo e normaliza ordem dos dois grupos |
| reorder_siblings | nodeId, targetIndex | Reordena dentro do pai atual |
| rename_map | title | Altera título do mapa, sem mudar texto da raiz |
| set_project | projectId ou null | Associa projeto da mesma equipe |
| transfer_owner | ownerId | Aplica regra de responsável/admin |
| delete_map | vazio | Soft delete após validar papel |
| undo / redo | targetOperationId | Usa registro confiável, nunca snapshot enviado pelo cliente |

Resposta canônica das mutações: operationId, revision, changedNodes (registros completos), deletedNodeIds e mapPatch. Dados de histórico ficam no servidor; cliente mantém referências e dados locais necessários à interface. Criação/cópia/importação retornam mapId e revisão inicial por operação idempotente separada. Preferências têm API própria, sem expectedRevision de conteúdo. Aplicação IA é operação interna ai_expand, nunca comando público com textos arbitrários.

Checks de entrada de cada comando recusam campos desconhecidos. Para add_child, pai já deve existir; fila respeita dependência entre criação de pai e filho. A invariância de exatamente uma raiz é verificada ao final de cada transação e uma restrição única impede múltiplas raízes. Validar árvore inteira no create/import/copy/restore, além das alterações incrementais.

Todas as mutações de conteúdo respeitam essa fronteira, inclusive renomear, mover, excluir, IA e desfazer. Preferências são separadas. Metadados autoria não são restaurados a partir de dados arbitrários do browser. Funções de restore usam somente snapshots confiáveis registrados no servidor.

## 5. Estado local, fila, conflitos e histórico

Alterações locais imediatas. Coalescer edição de texto após 650 ms sem digitação ou no blur; manter uma requisição de escrita em voo por mapa. Operações estruturais aguardam alterações de texto anteriores, mantendo resposta visual local. Mostrar Alterações pendentes/Salvando/Salvo/Falha/Conflito com texto acessível. Uma confirmação antiga não marca alterações novas como salvas.

IndexedDB guarda documento-base, operações pendentes e texto em edição, por user_id/workspace_id/map_id. Escrever durante edição com debounce de 200 ms e flush em blur/visibilitychange; informar limites se armazenamento indisponível. Sessão expirada mantém rascunho isolado e pede login da mesma conta. Logout deliberado com pendências oferece sincronizar, exportar cópia ou descartar; depois limpa caches/rascunhos dessa conta. Outra conta nunca recebe esses dados.

Em conflito, pausar fila. Preservar documento local; oferecer “Salvar minha versão como cópia” ou “Descartar minhas alterações e abrir versão atual”, com confirmação para descarte. Sem merge automático. Revogação de acesso oculta dados/caches e não oferece criar cópia no workspace revogado. Se conexão cai, edição local continua como rascunho; IA fica indisponível. Não prometer suporte offline integral.

Histórico só na sessão atual. Um gesto estrutural ou edição de texto concluída = uma operação. Desfazer última ação própria exige cabeça do mapa compatível e usa inverso registrado pelo servidor. Refazer usa operação original registrada. Nova edição invalida redo. Desfazer/refazer não reinventa criadores. Ao detectar operação de outra sessão, invalidar histórico e recarregar só quando não há pendências. Histórico limitado a 100 entradas locais, sem apagar registros de operações necessários à recuperação/idempotência. IA chega como uma operação de lote; após edições posteriores, seguir ordem de desfazer normal.

## 6. IA: aplicação direta e concorrência

Frontend envia mapId,parentNodeId,generationId,editorSessionId e orientação. Antes de pedir IA, esvaziar fila de edição e confirmar pai salvo. Servidor verifica membro, capacidade e limites; reconstrói contexto do banco: título, caminho até pai e filhos atuais. Orientação e textos são dados, não instruções de sistema. Conteúdo de outros mapas não entra. Limitar contexto a 12.000 caracteres; se exceder, retornar erro claro sem truncamento silencioso.

Edge Function chama adaptador OpenAI Responses com saída estruturada {children:[{text}]} e exatamente quatro filhos de até 120 caracteres. Validar localmente mesmo com schema estruturado; rejeitar recusa, JSON inválido, vazio e repetição literal entre filhos/irmãos normalizada por espaços e caixa. Não executar ferramentas nem navegar na web. Timeout 45 s, sem retry automático de chamada cobrada; nova tentativa explícita usa novo generationId após falha terminal. Repetir id em andamento consulta estado, não chama modelo de novo.

Após geração, worker aplica os quatro nós numa transação de finalização: bloqueia job e mapa, revalida acesso do solicitante, mapa ativo, pai existente, capacidade e fingerprint do contexto relevante. Se só outro ramo mudou, pode aplicar sobre a revisão atual; se título/caminho/filhos mudaram, state=stale, nenhum nó inserido. A inserção direta é no servidor; substitui o plano anterior de confiar um payload IA ao cliente. IDs e autoria vêm do servidor, source=ai, operação única. Estado applied só após commit. Sem painel de aceite.

Browser consulta estado a cada 1 s enquanto há job e página visível. Reconciliar patches IA com fila: aguardar escrita em voo; sincronizar automaticamente só quando revisão base ainda é a revisão anterior ao lote. Havendo edições locais novas ou revisão intermediária desconhecida, preservar documento local e usar fluxo de conflito; não descartar digitado. Sem pendências, integrar nós e registrar lote no histórico se compatível. O mapa permanece editável durante a chamada; o caso concorrente exige tratamento, não suposição de que o usuário ficou parado.

Cancelar faz transação competindo pelo mesmo lock do job. Se cancelar vencer, nenhum nó entra; se aplicação já ocorreu, informar e oferecer Desfazer. Fechar aba não cancela automaticamente: job pode completar e nós estarão lá ao reabrir. Jobs running expirados após 2 minutos são marcados failed ao consultar/iniciar nova geração; finalização tardia falha. Cancelamento pode não evitar cobrança já iniciada.

Limites iniciais configuráveis no servidor: uma geração ativa por usuário; 10 solicitações/minuto/usuário; 100 gerações/dia UTC/workspace. Reserva atômica antes do provedor, incluindo teto de tokens diário definido por AI_DAILY_TOKEN_BUDGET (obrigatório no ambiente real). Reservar teto de entrada+saída e reconciliar com usage; uso desconhecido mantém reserva conservadora. Máximo de saída configurado pelo adaptador. Registrar ids, duração, estado e tokens; não registrar texto dos mapas ou segredos em logs. Limites locais não garantem teto monetário; configurar limite de gasto na conta do provedor quando disponível antes da publicação.

## 7. Projeto Supabase único, migrações e verificação

Decisão explícita do usuário: usar desde o ticket 02 o projeto Supabase final, compartilhado pelo desenvolvimento e pelo app publicado. Não haverá banco local, staging, branch de banco nem segundo projeto para testes. Docker/Podman não são pré-requisitos. O frontend continua podendo rodar no computador, conectado à URL HTTPS desse projeto; estado local do editor e IndexedDB continuam iguais.

No ticket 02: identificar o projeto final por referência/URL, inspecionar schema e histórico existentes, aplicar apenas migrações pendentes, configurar Auth e provisionar primeiro administrador/equipe real. Credenciais administrativas só em ambiente seguro; chave publicável no frontend. Não inferir que o banco está vazio sem verificar.

Migrações continuam versionadas. Usar CLI remota ou conector Supabase autenticado, sem ferramentas que dependam de Docker. Conferir assinatura da CLI por --help; gerar nomes de arquivos com migration new quando usar CLI. Revisar SQL, verificar dependências e aplicar uma vez, com registro no histórico de migrações do projeto. Preferir mudanças aditivas/transacionais. Não executar db reset, drop schema, truncate, reaplicação cega de seed ou restore completo para verificar a instalação. Não editar uma migração já aplicada; correções são novas migrações. Advisors e tipos TypeScript vêm do projeto final, sem --local. Não usar db pull/diff como requisito se demandarem container; reconciliar arquivos e histórico via recursos remotos disponíveis.

Verificação continua obrigatória, mas sem recriar banco:

- Unitários e testes de componentes rodam no computador sem serviço de banco local. Smoke de interface sem configuração continua disponível.
- Auth/RLS e integração rodam contra o projeto final, com identidades autorizadas e dados pontuais identificados por run_id/UUID. Os papéis A/B/C/D dos tickets representam cenários de permissão, não um seed fixo a instalar no banco da equipe.
- Usar contas dedicadas de validação no MESMO projeto quando o cenário alterar senha, metadata, vínculo ou revogação; não alterar acesso de colegas reais para testar. Senhas aleatórias em ambiente seguro, nunca fixtures públicas fixas. Dados e contas temporárias são registrados por IDs exatos e removidos somente se criados pela própria execução; recursos reais preexistentes são preservados. Nenhuma limpeza por nome genérico, tabela inteira ou exclusão global de usuários.
- Para testar ausência de acesso, usar chamada anônima/usuário sem vínculo; somente se necessário para uma política entre equipes, criar recursos temporários mínimos no mesmo banco e removê-los por IDs após verificar. Não criar ambiente permanente de testes.
- Testes de transação podem usar rollback quando viável. Fluxos HTTP reais não compartilham uma transação de teste: precisam de recursos delimitados e limpeza explícita. Concorrência usa mapas descartáveis da execução, nunca mapas de trabalho da equipe.
- Remover pressupostos de loopback dos testes existentes somente ao substituí-los por validação do project ref esperado, seleção de identidades seguras e delimitação de dados. Não apontar seed-local ou senhas conhecidas para o remoto nem simplesmente desligar suas proteções.
- Registrar o que foi verificado e os recursos de validação restantes em caso de falha. Falta de acesso ao projeto/credenciais é dependência externa; ausência de Docker não bloqueia mais nenhum ticket.

Backup do app é verificado exportando e importando um mapa como cópia no mesmo banco. Verificar estrutura e remover somente a cópia de validação. Recuperação completa de banco é documentada segundo recursos realmente disponíveis no plano Supabase, sem executar restore destrutivo ou exigir outro ambiente.

IA falsa permanece exclusiva de testes unitários/de componentes. No projeto final, chamadas reais exigem configuração de modelo, limites e orçamento; manter recurso desativado para a equipe até concluir os controles 20–22. Smoke controlado pode ser feito antes, com limites no servidor e acesso restrito às identidades de validação. Nunca disponibilizar endpoint de geração ilimitada durante uma etapa intermediária.

## 8. Entradas externas (solicitar na etapa correspondente)

- Ticket 02: referência/URL do projeto Supabase final, chave publicável, acesso administrativo seguro via conector ou CLI, e-mail do primeiro administrador e nome da equipe. Node/npm continuam necessários para o frontend; Docker não é necessário.
- Tickets 03–04: entrega real de e-mails Auth, redirects para URL local do frontend e URL publicada quando disponível; SMTP ou serviço de envio do projeto habilitado para os destinatários autorizados. Esses testes não aguardam o ticket 26.
- IA: OPENAI_API_KEY, AI_MODEL compatível e orçamento/limites configurados no servidor.
- Publicação: acesso Vercel e URL final; conferir redirects/origins e configurações do MESMO projeto Supabase, sem migrar dados entre ambientes ou criar staging.

## Fontes verificadas no planejamento

- https://reactrouter.com/start/data/installation
- https://reactflow.dev/learn/advanced-use/accessibility
- https://reactflow.dev/learn/advanced-use/performance
- https://d3js.org/d3-hierarchy/tree
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
- https://developers.openai.com/api/docs/guides/structured-outputs

Antes de integrar, conferir APIs com a versão fixada. Este contrato define comportamento, não substitui documentação de assinatura de bibliotecas.
