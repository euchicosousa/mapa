# 04: Convidar uma pessoa para entrar na equipe

**What to build:** Administrador envia convite e a pessoa passa a integrar a equipe ao concluir o acesso.

**Blocked by:** 03: Recuperar senha e concluir links de autenticação

**Status:** done — concluído em 20/10/2026 com Auth/SMTP reais, desktop/mobile e aceite concorrente validado.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Criar convites com validade e estado conforme contrato. Tela /equipe lista membros e convites; só admin envia/revoga/reenvia.
2. Edge Function valida token e papel no banco antes de usar API administrativa Supabase. Reservar convite no banco, enviar por inviteUserByEmail para conta nova e registrar resultado de modo recuperável; envio de e-mail não é transação SQL.
3. Para conta já existente, registrar convite e informar ao admin que ela pode entrar para aceitar; usuário autenticado com e-mail confirmado encontra convite pendente em /sem-acesso. Nunca retornar listagem geral de usuários Auth.
4. Aceitar convite vincula apenas o user id autenticado cujo e-mail confirmado corresponde ao convite ainda válido, com transação idempotente. Reenvio com cooldown de 60 s; falha permite repetir sem duplicar vínculo. Convite revogado não concede acesso mesmo se o link ainda autenticar a pessoa.

## Critérios de aceite

- [x] Novo convidado define senha, aceita convite e vê a equipe; repetição não duplica vínculo.
- [x] Membro comum e usuário externo não convidam nem revogam pela API.
- [x] Convite vencido/revogado ou e-mail divergente não ativa membro.
- [x] Falha de envio fica visível e pode ser retomada sem mostrar sucesso falso.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Teste real com Auth/e-mail no projeto final, contas autorizadas e recursos delimitados; testar conta nova, existente, reenvio e dois aceites concorrentes.

## Limites desta entrega

Admin inicial já existe pelo bootstrap. Não configurar provedores OAuth nem envio comercial.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Implementado e verificado em 20/10/2026, preservando a UI atual:

- `/equipe` lista pessoas e, para administradores, convites com envio, validade e estado. Criar/revogar/reenviar usa Edge Function autenticada com papel revalidado no banco. Convites entram como membro, nunca administrador.
- `workspace_invitations` com RLS, validade de sete dias, endereço normalizado, unicidade de pendente por equipe/e-mail, claim de envio, cooldown de 60 segundos e estados recuperáveis de entrega. Duplicar criação não manda outro e-mail; renovar/repetir é ação explícita.
- Conta nova recebe `inviteUserByEmail` pelo SMTP real; conta existente recebe convite pendente e orientação de login/aceite, sem afirmar envio de e-mail. Nenhuma listagem geral de usuários Auth é devolvida.
- `/sem-acesso` apresenta apenas convites válidos do e-mail confirmado da identidade autenticada. Aceitar é transacional e idempotente, com vínculo único. Convite revogado/vencido, e-mail não confirmado/divergente e vínculo ativo em outra equipe não concedem acesso.
- Locks serializam gestão e aceite; ajuste para NO KEY UPDATE mantém compatibilidade com locks de FK ao criar vínculo. Três corridas reais aceitar × revogar confirmaram um único vencedor. Resposta tardia de SMTP não restaura convite revogado, e repetir um aceite antigo não reativa acesso posteriormente desativado.
- Fronteira de privilégio: RPCs públicas SECURITY INVOKER, funções privadas com search_path fixo/ACL específica, ações administrativas exclusivas de service_role e identidade derivada de getUser(token). Não há chave secreta no frontend.
- Script de limpeza passou a remover os convites dos workspaces registrados antes dos perfis/identidades. Scripts de validação só alteram recursos identificados da própria execução.

Migrações aplicadas e conferidas no histórico do projeto final `bodxafqkqlyfoyfgahyj`:

- `20261020192357_workspace_invitations.sql`.
- `20261020193516_invitation_lock_order.sql`.

Função `manage-invitation` publicada por API, JWT obrigatório, sem Docker. Tipos regenerados do projeto real. Nenhuma configuração SMTP foi substituída.

Verificações:

- Typecheck, lint, build e proteção de credenciais no bundle: passaram. Avisos preexistentes de chunk e anotações Zod permanecem.
- `npm test`: **100/100**, 16 arquivos.
- `npm run test:rls`: **46/46** no projeto real.
- `node --test tests/integration/invitations.test.mjs` (também disponível em `npm run test:invitations`): **6/6**, incluindo criação/revogação negadas para B/C/D, RPCs administrativas fechadas, privacidade, conta existente, cooldown/retry, expiração/revogação, dois aceites simultâneos e três corridas aceitar × revogar.
- `tests/integration/invitations.sql`: passou com rollback integral; incluiu e-mail não confirmado/divergente, prazo, normalização/duplicação, falha de entrega registrada, novo claim após cooldown e finalização tardia após revogar.
- `npm run test:e2e:auth -- invitations.spec.ts`: **2/2** cenários completos, em 1440×900 e 390×844, execução `20261020-455fcd` limpa. Falha registrada de envio foi fixture explícita e delimitada para validar sua apresentação/retomada; SMTP não foi desconfigurado nem simulado no produto.
- Smoke com e-mail real para ochicosousa@gmail.com: novo destinatário criado pelo convite administrativo, link real aberto em contexto mobile separado, senha definida, login, aceite e um único vínculo ativo de membro. Administrador viu Aceito. Execução `20261020-48dc3b` limpa; prova em `evidence/04/real-email.json`.
- Gmail colocou o convite real em **SPAM**, com SPF/DKIM pass. Incluída orientação para conferir essa pasta. Não foi alterada a classificação da caixa. O template continua padrão em inglês.
- Capturas desktop/mobile inspecionadas, sem overflow e com ações por toque; não equivale a teste em telefone físico.
- Advisors: nenhum problema novo. Permanecem as informações de RLS sem política em tabelas internas já fechadas e o aviso preexistente de proteção contra senhas vazadas.
- Consulta SQL final: identidade Gmail de teste ausente; zero destinatários e convites de validação restantes; duas migrações do ticket presentes. `.validation-runs` vazio e servidor temporário encerrado. Dados e acesso da equipe real preservados.

As primeiras rodadas E2E encontraram uma espera ambígua por avisos de carregamento e reutilização da conta entre projetos; os testes foram ajustados para esperar a resposta específica e usar destinatários independentes. A rodada completa foi repetida com sucesso; recursos anteriores também limpos.

Operação: [docs/CONVITES.md](../../../docs/CONVITES.md). Evidências: [evidence/04/README.md](../evidence/04/README.md).

Limites: na publicação, incluir o callback HTTPS na lista do Auth e em MAPA_AUTH_CALLBACK_URLS da função. Sem publicação na Vercel nesta fatia. Desativação de membro é escopo do **15**, agora desbloqueado por 04 e 14. Nenhum trabalho do 15 foi iniciado.
