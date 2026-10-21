# Verificação do planejamento

- 28 tickets individuais; todos possuem entrega, bloqueadores, implementação, critérios, testes e dependências externas.
- Grafo sem dependências ausentes ou futuras; numeração é uma ordem topológica válida.
- Gate final 28 depende transitivamente dos outros 27 tickets.
- Estado ready-for-agent consistente entre manifesto e arquivos.
- Referências locais verificadas.
- Decisões centrais revisadas: Supabase Auth/banco, autoria imutável, responsável distinto de editor, mobile por fatia, IA direta sem aceite.
- Casos de integridade cobertos: conflito de revisão, retry idempotente, undo por snapshot servidor, fonte IA não forjável, cancelamento concorrente e revogação de acesso.
- Implementação, banco, testes do app e deploy ainda não executados; esta revisão verifica somente a especificação e seus arquivos.

Divisão aprovada explicitamente pelo usuário em 19 de outubro de 2026; transição para ready-for-agent concluída nos 28 tickets e no manifesto.

## Revisão visual posterior

Ticket 01 reaberto por solicitação do usuário: Swiss Design, escala neutra entre #fafafa e #121212, com cinzas intermediários autorizados. Cantos retos restritos ao shell; formato dos nós e personalização ficam para discussão posterior. Contrato, ticket, manifesto e guia atualizados. Código do app não alterado nesta revisão do planejamento; implementação visual e capturas novas ficam pendentes no ticket 01.

## Banco único

Decisão do usuário incorporada ao contrato, tickets e guias: projeto final desde o ticket 02; sem Supabase local/staging/Docker. Ticket 02 volta a ready-for-agent para adaptar ferramentas e testes, ainda sem validação real. Registros antigos de falha local são históricos. Nenhuma alteração de banco remoto executada nesta revisão.

## Ticket 13 concluído — 19/10/2026

Biblioteca por projeto/responsável, busca server-side e paginação de 20; projetos com RLS e metadados versionados com histórico. Validado no Primary: 57 testes unitários e 33 de integração, fluxo novo E2E 2/2 em desktop/mobile, regressão inicial 7/8 e histórico corrigido 4/4 em repetição. Corrigido clique perdido ao concluir edição; evidência e limites em `evidence/13/resultados.json`. Migração 20261020023507 conciliada, dados temporários removidos. Ticket e manifesto done; próximo 14, ainda não iniciado.

## Ticket 14 concluído — 20/10/2026

Transferência por responsável/admin para membro ativo da mesma equipe, preservando criador, autoria e edição colaborativa. Comando versionado e idempotente no Primary; transferência é barreira de histórico explicada na interface. Migração 20261020025706 conciliada. Verificações: 61 unitários, 36 de integração reais, 4/4 E2E finais de transferência desktop/mobile, biblioteca 2/2. Resposta perdida e recarga verificadas; todos os dados temporários removidos. Resultados anteriores e limites em `evidence/14/resultados.json`. Ticket e manifesto done; total 12/28 concluídos, 16 restantes; próximo na sequência 17, ainda não iniciado.

## Ticket 17 concluído — 20/10/2026

Exclusão lógica versionada por responsável/admin, confirmação com título, RLS de mapas/nós/preferências e bloqueio de replay/edição/cópia após exclusão. Sessão antiga preserva rascunho somente com vínculo ativo, exportação revalidada e sem restauração automática. Migrações 20261020130503 e 20261020130940 conciliadas no Primary. Verificações: 64 unitários, 39 de integração reais, 12/12 E2E combinados e 2/2 finais de proteção de rascunho em desktop/mobile. Dados temporários removidos. Resultados e limites em `evidence/17/resultados.json`; ticket/manifesto done. Total 13/28 concluídos, 15 restantes; próximo na sequência 16, ainda não iniciado.

## Ticket 16 concluído — 20/10/2026

Duplicação remota por membro ativo: snapshot coerente com lock, cópia independente com projeto/textos/estrutura/ordem, IDs novos e autoria manual do solicitante. Reutiliza a primitiva privada da recuperação local, com validação integral da árvore; origem informativa somente no log de criação. Replay estável após alteração da origem, sem importar histórico/jobs/preferências. Confirmação/erro/armazenamento e duplo clique verificados, inclusive recarga após resposta perdida. Migrações 20261020133059 e 20261020133607 conciliadas no Primary (18 versões totais). Verificações finais: 64 unitários, 43 integrações reais, 18/18 E2E desktop/mobile, lint/typecheck/build/bundle. Contagens originais preservadas e recursos temporários removidos. Resultados anteriores e limites em `evidence/16/resultados.json`. Ticket/manifesto done; total 14/28 concluídos, 14 restantes. Próximo recomendado 18, ainda não iniciado; sem deploy nesta fatia.

## Ticket 18 concluído — 20/10/2026

Backup portátil JSON v1 com schema/fixture documentados, snapshot local imutável incluindo texto pendente e ramos recolhidos, aviso visual/hasPendingChanges, limites integrais de árvore/texto/arquivo e nome sanitizado. Campos explícitos excluem Auth, equipe, autoria e outros mapas. Leitura real de acesso antes do download, sem escrita/revisão ou mudança no banco; saída durante checagem/revogação bloqueia arquivo tardio. Emergência técnica permanece separada. Verificações: 76 unitários, typecheck/lint/build/bundle, 6/6 E2E do recurso e 12/12 de regressão de duplicação/exclusão em desktop/mobile; checagem adicional 360 px. Recursos de validação removidos; 18 versões de migração anteriores preservadas e conciliadas no Primary. Evidências em `evidence/18/resultados.json`. Ticket/manifesto done; total 15/28 concluídos, 13 restantes. Próximo recomendado 19, não iniciado; sem deploy.

## Ticket 19 concluído — 20/10/2026

Importação portátil v1 com limite pré-leitura/UTF-8/schema compartilhado, confirmação e novo mapa com IDs/autoria da sessão. Servidor deriva equipe ativa, valida payload direto e usa a primitiva atômica de cópia/recuperação. Replay por operationId/fingerprint após resposta perdida e reseleção na recarga. Índices de ordem normalizados para preservar sequência e permitir novas adições mesmo com valores altos. UI preservada; apenas controles funcionais e campo de arquivo limitado em 360 px. Migrações 20261020145943 e 20261020150900 conciliadas (20 totais), dados temporários removidos. Verificações: 78 unitários, 46 integrações completas + 3 revalidações finais, 6/6 E2E finais de importação desktop/mobile e exportação regressiva 6/6. Resultados anteriores/limites em `evidence/19/resultados.json`. Ticket/manifesto done; total 16/28 concluídos, 12 restantes. Próxima fase 03–04–15 depende de SMTP, IA 20–22 depende da configuração do provedor; não iniciadas. Sem deploy/redesign nesta entrega.
