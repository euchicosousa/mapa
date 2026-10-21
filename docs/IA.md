# Geração de caminhos — tickets 20 a 22

A IA gera exatamente quatro filhos do nó selecionado, em texto puro de até 120 caracteres. A inserção acontece diretamente no servidor em uma transação, com autoria do solicitante e `source=ai`. O lote pode ser desfeito/refeito como uma única operação da sessão. Não existe etapa de aprovação dos textos.

## Configuração e acesso

O projeto final é `mapa` (`bodxafqkqlyfoyfgahyj`). A função `generate-children` usa `OPENAI_API_KEY`, `AI_MODEL` e `AI_DAILY_TOKEN_BUDGET` no armazenamento de segredos do Supabase. Nunca usar prefixo `VITE_` nesses valores. O teto autorizado em 20/10/2026 é 50.000 tokens/dia UTC por workspace; o modelo configurado é `gpt-6-luna`. `node scripts/configure-ai.mjs` envia somente esses três valores a partir da configuração local, usando arquivo temporário privado que é removido ao terminar; não envia as configurações públicas do frontend.

Com os controles do ticket 22 verificados, a geração está liberada para membros ativos por `private.ai_settings.enabled=true`. Durante manutenção, desligar essa flag bloqueia novos pedidos da equipe. Identidades descartáveis registradas pelos testes podem receber liberação temporária, válida por uma hora e removida com a identidade. Não há chave, modo falso ou liberação administrativa no navegador. Falta de configuração retorna indisponibilidade; nunca retorna textos simulados.

## Job e chamada ao provedor

O navegador envia IDs do mapa, pai, geração e sessão, mais uma orientação opcional de até 1.000 caracteres. A Edge Function valida a identidade com Auth; a reserva verifica acesso ativo, mapa, pai, profundidade, capacidade para quatro nós, disponibilidade e cotas antes da chamada. O contexto vem somente do banco: título, caminho até o pai e seus filhos atuais. O limite de 12.000 caracteres é verificado sem truncamento. Há também um teto conservador de 13.000 bytes para o pedido temático completo, mantendo a reserva de tokens segura para textos Unicode.

A reserva é atômica e exclusiva por usuário. Repetir o mesmo ID e payload consulta o job; outro payload com esse ID é conflito. Não há retry automático da chamada paga. Requests concorrentes ao mesmo job resultam em uma só chamada ao provedor.

O adaptador usa OpenAI Responses, `store=false`, schema estrito e saída máxima de 2.048 tokens. Título, caminho, filhos e orientação são enviados como dados não confiáveis. Não usa ferramentas, pesquisa ou streaming. Recusa, timeout de 45 segundos, JSON inválido, texto vazio, quatro textos não distintos ou repetição de irmão existente impedem a inserção. A normalização compara caixa e espaços.

## Limites atômicos e contabilização (ticket 22)

Os limites são uma geração ativa por usuário, 10 solicitações admitidas em janela móvel de um minuto por usuário e 100 gerações por dia UTC por workspace. Somente o servidor configura valores: `private.ai_settings` limita parâmetros aos tetos aprovados; orçamento efetivo é o menor entre `AI_DAILY_TOKEN_BUDGET` e o teto privado de 50.000. A ausência de configuração bloqueia novas chamadas. IDs rejeitados não consomem cota; replays do mesmo ID retornam o job sem nova reserva ou chamada paga.

Cada pedido reserva 17.000 tokens em `private.ai_usage_days` sob lock transacional. Concorrência entre usuários não pode consumir o mesmo último saldo. O dia é calculado pelo relógio UTC depois da espera pelos locks. Contagem diária nunca é devolvida por cancelamento ou falha. Uso válido informado pelo provedor substitui a reserva exatamente uma vez, mesmo em recusa ou saída inválida. Uso desconhecido, timeout e cancelamento conservam a reserva. Um uso tardio conhecido pode reconciliar o dia original do job, inclusive depois da meia-noite, sem reviver estado terminal ou inserir nós cancelados. A checagem de uso exige inteiros não negativos e soma de entrada/saída igual ao total.

O ledger e eventos não têm acesso direto por `anon`/`authenticated`; RLS sem policies nessas tabelas privadas é intencional. Funções de reserva/finalização são exclusivas de serviço. O navegador não escolhe ator, modelo, orçamento ou contabilização.

## Falhas, nova tentativa e observabilidade

Limite por minuto, quantidade diária e saldo de tokens têm códigos distintos (`AI_RATE_LIMIT`, `AI_DAILY_LIMIT`, `AI_BUDGET_LIMIT`), HTTP 429 e `Retry-After`. A interface mostra o motivo e horário local de nova tentativa, mantém a edição disponível e não inicia chamadas quando termina a espera. Uma nova geração depende sempre de ação explícita. Configuração ausente, credencial/modelo inválido, indisponibilidade, limite do provedor, limite de gasto, recusa, saída inválida e timeout têm mensagens próprias. Detalhes brutos do provedor e do banco não são exibidos.

A Edge Function emite JSON com somente `event=ai_generation`, `generationId`, `state`, `code`, `latencyMs`, `inputTokens`, `outputTokens` e `totalTokens`. Não inclui contexto, orientação, texto gerado, chave, senha, JWT ou headers. Jobs e ledger guardam estados, IDs, uso e timestamps para correlação; `private.ai_usage_events` registra reserva/reconciliação sem conteúdo. Não imprimir payloads brutos ao investigar falhas. O smoke usa um marcador na orientação para confirmar sua ausência nos logs da aplicação.

## Limite financeiro do provedor e resultados temporários

Antes da publicação (tickets 26–28), o responsável pela conta deve escolher o valor monetário em OpenAI **Project settings → Limits → Spend → Edit spend limit → Monthly amount → Enforce a hard limit → Save**. Um alerta sozinho não interrompe o gasto. O limite pode apresentar pequeno excedente até a aplicação efetiva; erros de limite de projeto/organização são tratados como `PROVIDER_BUDGET`. Conferir a [documentação oficial de limites de gasto](https://developers.openai.com/api/docs/guides/spend-limits). Este ticket documenta a configuração, sem alterar cobrança nem escolher um valor financeiro em nome do usuário. O limite diário de tokens do aplicativo não é garantia de preço.

Responses usa `store=false`. Contexto e saída existem somente na memória do worker durante a requisição e não são copiados para logs ou para o job. O resultado aplicado permanece nos nós e em `map_operations`, necessário ao histórico/idempotência; isso não é um cache temporário a apagar. Estados e contabilidade permanecem no banco. Dados dos testes são removidos por IDs exatos de cada execução; os relacionamentos eliminam também ledger/eventos descartáveis, sem tocar dados da equipe.

## Aplicação e preservação do texto

A finalização bloqueia job e mapa e revalida vínculo ativo, mapa não excluído, pai, profundidade, capacidade e fingerprint do contexto. Mudança no título/caminho/filhos torna o resultado obsoleto, sem inserção. Alteração em outro ramo permite aplicar sobre a revisão atual. Os quatro IDs são criados pelo servidor e a revisão sobe uma vez, com uma operação `ai_children`.

O browser consulta o job a cada segundo enquanto ativo e com página visível. Escrita em voo precisa terminar antes de reconciliar a IA. Sem pendências e com revisão anterior compatível, o lote entra no documento e no histórico. Com rascunho, fila ou revisão intermediária desconhecida, o texto local fica preservado no fluxo de conflito existente, com cópia ou descarte confirmado. A edição do mapa continua disponível durante a geração.

O ID da sessão sobrevive à recarga. Um job aplicado já incluído no documento não é reaplicado nem ressuscita uma ação desfeita. Fechar a página não cancela o worker. Jobs expirados após dois minutos falham ao consultar/reservar ou finalizar. O cancelamento descrito abaixo foi entregue no ticket 21.

Os textos ficam nos nós e no log autorizado de operações, necessário ao desfazer/refazer. O job não guarda cópia permanente do contexto ou resultado: seu retorno aplicado é reconstruído do log. Metadados, modelo, uso, estado e timestamps permanecem para idempotência e contabilização.

## Cancelamento e retomada (ticket 21)

`cancel_ai_generation` recebe somente o mapa e o ID do job. A identidade vem da sessão Auth. Somente o próprio solicitante, ainda membro ativo da equipe, pode cancelar. Outro colega não cancela jobs alheios. O wrapper público é invoker; a transação privilegiada fica no schema privado com permissões explícitas e `search_path` vazio.

Cancelamento e finalização bloqueiam o mesmo job antes do mapa e do vínculo. Se cancelar vencer, o estado terminal é `cancelled`, sem alteração dos nós, revisão ou histórico. Resultado tardio não reabre o job; apenas uso real ainda desconhecido pode ser contabilizado. Se aplicação vencer, cancelar retorna `applied` e o lote existente. A interface explica o resultado e oferece **Desfazer geração** somente quando o lote é a próxima operação reversível desta sessão. Edições posteriores não são removidas pelo cancelamento.

Resposta perdida mantém o mesmo ID para consultar ou repetir o cancelamento. Consulta e cancelamento nunca chamam o provedor. A tela informa que fechar a página não cancela o trabalho e que uma chamada já iniciada pode ser cobrada.

A consulta retoma o job ativo do próprio usuário mesmo ao abrir uma aba nova, cujo ID de sessão é diferente. O documento confirmado impede reaplicar o lote e a sessão nova não ganha histórico anterior. Polling tem no máximo uma leitura em voo, pausa com a página oculta e retoma imediatamente ao voltar. Falhas transitórias de consulta são repetidas; uma revogação encerra a leitura e aciona a proteção de acesso existente.

Prazos usam o relógio real depois de aguardar locks, em vez do horário de início da transação. Jobs com prazo vencido falham ao consultar, cancelar, iniciar outra solicitação ou finalizar; a resposta tardia não insere filhos. Cancelar depois de uma falha, obsolescência ou cancelamento confirmado devolve o mesmo estado terminal.

Excluir o mapa ou perder acesso durante a geração impede a aplicação. A consulta distingue `MAP_DELETED`, revelado apenas a membro ainda autorizado, de revogação. Mapa excluído preserva o rascunho para exportação de emergência verificada; acesso revogado oculta conteúdo e limpa o editor e os registros locais conforme o fluxo existente.

## Verificação

- `npm test`: validação do adaptador e reconciliação do editor, com respostas artificiais apenas em testes.
- `tests/integration/ai-transactions.sql`: testes de reserva, finalização, LIFO, proveniência, obsolescência, acesso, expiração, orçamento e capacidade em uma transação com rollback; não deixa fixtures nem chama o provedor.
- `MAPA_AI_VALIDATION=1 npm run test:e2e:auth -- ai.spec.ts`: usa OpenAI e Supabase reais, contas temporárias e desktop/mobile. Inclui chamada repetida com resposta perdida, histórico, colega, rascunho durante geração e tentativas de forjar IA.
- `npm run test:rls`: regressão de isolamento e integridade do domínio já implementado.

As credenciais dos testes viajam somente pelo ambiente/pipe. Contas, mapas e liberações criados pela execução são removidos pelos IDs registrados em `.validation-runs`.

Verificações específicas do ticket 21:

- `node --test tests/integration/ai-concurrency.test.mjs`: usa uma resposta real obtida pelo adaptador de produção e a reutiliza como entrada do worker em mapas descartáveis. Verifica as duas ordens de cancelamento/finalização, chamadas realmente concorrentes, exclusão concorrente, fingerprint, acesso, expiração, transferência e retomada. Respeita as cotas do servidor; não publica adaptador falso ou endpoint de teste.
- `MAPA_AI_VALIDATION=1 npm run test:e2e:auth -- ai-cancellation.spec.ts`: worker e OpenAI reais, desktop/mobile, incluindo resposta perdida, cancelamento tardio, reabertura em outra aba, contexto obsoleto, exclusão com rascunho e revogação.
- Testes de polling e componente cobrem visibilidade, leituras em voo, falha inicial, resposta atrasada, retry do cancelamento e preservação de alterações posteriores.

Verificações específicas do ticket 22:

- `tests/integration/ai-limits-transactions.sql`: rollback com fronteira UTC, janela móvel, cota diária, reserva, uso inválido, cancelamento, expiração, reconciliação tardia e privilégios.
- `node --test tests/integration/ai-budget.test.mjs`: concorrência HTTP no último saldo, idempotência e proibição de alterar contabilização pelo cliente, sem chamada ao provedor.
- `MAPA_AI_VALIDATION=1 npm run test:e2e:auth -- ai-limits.spec.ts`: limite real na Edge Function, edição após bloqueio e lote real com uso registrado; desktop e mobile.
- `MAPA_AI_ROLLOUT=1 npm run test:e2e:auth -- ai-limits.spec.ts -g 'real smoke'`: o mesmo smoke sem allowlist temporária, comprovando a liberação por vínculo ativo.
- Testes de handler/adaptador/componentes verificam ausência de chamada quando bloqueada, erros recuperáveis, preservação do uso em falhas e logs com campos permitidos.

Advisors de segurança: tabelas privadas e `map_operations` sem policies são bloqueadas intencionalmente para clientes. O aviso preexistente de proteção contra senhas vazadas permanece para revisão de publicação; não é alterado por esta fatia.
