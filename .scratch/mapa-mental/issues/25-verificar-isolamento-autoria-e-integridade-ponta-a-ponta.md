# 25: Verificar isolamento, autoria e integridade ponta a ponta

**What to build:** Provar que contas fora da equipe não acessam dados e que operações malformadas não corrompem mapas.

**Blocked by:** 15: Desativar acesso de membros preservando autoria; 17: Excluir mapas com responsável ou administrador; 19: Importar backup como mapa novo e validado; 22: Limitar uso de IA e expor falhas recuperáveis

**Status:** done — concluído em 20/10/2026; fronteiras verificadas no projeto final, com advisor residual documentado.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Criar matriz executável com A admin, B membro de X, C membro de Y e D sem equipe; usar API com seus JWTs, não somente credencial administrativa.
2. Cobrir SELECT de todas as tabelas expostas, escrita direta negada, RPCs, funções privadas, convites, perfis, preferências, arquivo importado, worker IA e mapa excluído.
3. Testar falsificação de owner/created_by/source, role em user_metadata, pai cross-map, ciclos, raíz duplicada, operação id repetida com payload diferente e duas revisões simultâneas.
4. Rodar advisors Supabase e verificar grants/search_path/EXECUTE; justificar qualquer SECURITY DEFINER intencional. Conferir histórico de migrações aplicado e gerar tipos do projeto final; corrigir falhas na camada de origem.

## Critérios de aceite

- [x] Matriz de testes passa com acesso permitido e negado em cada fronteira.
- [x] Admin não recebe privilégios de outra equipe por conhecer UUID.
- [x] Desativação de membro bloqueia JWT antigo e finalização IA.
- [x] Nenhuma função administrativa é executável por anon/PUBLIC indevidamente.
- [x] Histórico remoto corresponde às migrações versionadas e todos os testes de integridade passam sem reset ou remoção de dados reais.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Suíte de integração controlada no Supabase final, advisors e inspeção de bundle/logs por segredos.

## Limites desta entrega

Não fazer pentest em ambientes externos nem mexer em dados reais.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Executado no Supabase final `bodxafqkqlyfoyfgahyj`, sem reset, seed, exclusão de dados reais, migração ou deploy. [Relatório](../../../docs/SEGURANCA.md) e [evidências](../evidence/25/) registram a matriz, catálogo, definições, advisors, histórico, logs agregados e capturas.

- Nova suíte `npm run test:security`: oito cenários, 248 verificações HTTP registradas em 54 fronteiras, com JWTs reais A admin/X, B membro/X, C membro/Y, D sem equipe e anon. SELECT das dez tabelas públicas, escrita direta protegida negada e CRUD de preferências próprias permitido. Admin X sem privilégio em Y por UUID. Metadata não concede papéis.
- Worker e convites: funções administrativas negadas para todos os JWTs comuns e anon; schema private não exposto via HTTP. Payloads IA malformados/forjados e equipe alheia não iniciam job. Mesmo JWT anterior perde autorização após revogação; finalização tardia retorna stale sem inserir nós. Nenhuma chamada ao provedor nesta entrega.
- RLS/importação/histórico: autoria, owner/source forjados, pai cross-map, ciclos, raiz duplicada/ausente, IDs repetidos, replay com payload diferente e revisões concorrentes verificados. Exclusão mantém conteúdo histórico inacessível.
- Catálogo remoto: 14 tabelas com RLS, 60 funções sem EXECUTE de PUBLIC/anon e search_path vazio; 29 SECURITY DEFINER privadas justificadas por grupo no relatório. Funções públicas SECURITY INVOKER. 33 migrações remotas correspondem a versões/nomes locais. Tipos regenerados do projeto final; typecheck/build aprovados.
- Advisors: cinco INFO de RLS sem policies são negação por padrão intencional em tabelas internas/log. Permanece WARN de proteção contra senhas vazadas desativada, com remediação e disponibilidade Pro+ documentadas; não se mudou plano/cobrança/Auth. INFO de índices também registrado, sem alteração por hipótese.
- Logs: agregação de 2.934 registros de funções nas 24 horas observadas, 74 eventos de geração, zero padrões de segredo/JWT e zero campos adicionais nos eventos IA. Não se exportaram mensagens brutas, tokens ou textos de mapas. Busca por padrões tem limites explícitos.
- API: 70/70 cenários aprovados (46 RLS + 8 segurança + 6 convites + 7 acesso + 3 orçamento). Interface: 18/18 após corrigir preparo de contas compartilhadas da suíte, em 390×844 e 1440×900. O servidor corretamente bloqueava a desativação por mapas criados por outros testes; a preparação agora transfere somente mapas da conta/equipe descartáveis. Regra do produto preservada; falha inicial retida como evidência.
- `npm test`: 124/124, 20 arquivos. Build/typecheck, lint e `test:bundle`: aprovados. `test:integration` inclui a nova matriz. Evidências de bloqueio, desativação e revogação copiadas para esta entrega.
- Limpeza final: zero contas/equipes temporárias restantes e `.validation-runs` vazio. Sem celular físico utilizado; interface móvel verificada em emulação.

Status final: **done**. Ticket 26 desbloqueado; não iniciado.
