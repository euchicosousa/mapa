# 27: Publicar a SPA e validar links diretos

**What to build:** O app fica acessível por uma URL e abre mapas diretamente no desktop e no celular.

**Blocked by:** 23: Completar navegação por teclado e acessibilidade mobile; 24: Medir e otimizar edição de mapas com 200 e 500 nós; 26: Preparar ambiente de publicação com Auth e banco reais

**Status:** done — concluído em 21/10/2026; bloqueadores 23, 24 e 26 concluídos.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Preparar build Vite e configuração Vercel de fallback para rotas SPA preservando assets. Variáveis de cliente somente URL/chave publicável; incluir limites de segurança em env server-side.
2. Publicar no destino autorizado; conferir redirects Supabase com URL final. Rodar smoke login, abrir link direto, refresh, convite, biblioteca e editor.
3. Configurar captura de erros sem conteúdo de mapas ou tokens; documentar versão publicada, migrações necessárias e rollback do frontend compatível. Migrações de banco não são revertidas destrutivamente por rollback de frontend.
4. Registrar evidência de bundle sem segredos e modo produção sem adapter falso. Verificar headers/caching apropriados, HTML atualizado e assets versionados.

## Critérios de aceite

- [x] /mapas/:id abre por link, refresh e voltar/avançar; 404 desconhecido funciona.
- [x] Login/callback/recuperação funcionam na URL publicada.
- [x] Editor mobile e desktop usa Supabase real; IA sem configuração mostra falha honesta.
- [x] Artefato publicado não contém credenciais administrativas, mocks de produção ou conteúdo de fixtures.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Smoke no deploy real com duas contas, inspeção de rede/assets e registro de URL/versão.

## Limites desta entrega

Sem domínio comprado ou infraestrutura extra; registrar bloqueio de deploy se autorização/acesso ausentes.

## Dependências externas

Acesso Vercel/projeto de destino e domínio/origin autorizados.

## Registro do executor

Publicado em **https://mapa.cnvt.com.br** no projeto Vercel mapa/agenciacnvt. Deploy final: `dpl_2qdMEvn4UEELuRscohiVBnqcFCJz`, URL imutável `https://mapa-4w1e095s2-agenciacnvt.vercel.app`, build `0.1.0+2026-10-21T11:59:12.983Z`. Estado READY e alias oficial confirmados.

`vercel.json` preserva assets e faz fallback das rotas para a SPA. HTML sem armazenamento; assets com hash, um ano de cache e immutable. Sete respostas de rotas e quatro assets publicados conferidos, incluindo editor lazy. Asset inexistente retorna HTTP 404; rota desconhecida recebe shell HTTP 200 e exibe 404 do app. HTTPS, nosniff, DENY, no-referrer e Permissions-Policy conferidos. Três valores secretos locais não foram encontrados; marcadores de fixtures não entraram no artefato. Bundle aponta para o projeto Supabase final e para a função real de IA. Sem mock/adapter falso no produto; ausência de configuração de IA segue coberta pelos testes de handler/componente, sem desligar a configuração real para testar.

Captura de falhas globais, promises e rotas somente com categoria, rota normalizada, versão e horário; limite de 20 em memória e console. Sem texto de mapa, identificador, e-mail, stack ou token nesse registro; teste de privacidade aprovado. Não há coleta centralizada, serviço extra ou monitoramento de campo contratado. Procedimento de publicação/recuperação compatível em docs/DEPLOY.md. Nenhum rollback executado; nenhuma migração ou mudança destrutiva no Supabase. Mesmas 33 migrações e configuração oficial Auth/CORS do ticket 26.

Verificação final: **10/10 testes públicos aprovados**, desktop 1440×900 e Chromium mobile emulado 390×844. Incluem criação/edição persistida com duas contas, link direto autenticado e retorno pós-login, recarga, voltar/avançar, logout, convite/aceite e papel de membro, callbacks reais de invite/recovery, senha, recarga do formulário, link inválido e 404. Os links dos testes foram gerados pelo Auth administrativo para contas descartáveis; esta rodada não afirma nova entrega SMTP em caixa humana (comprovada no ticket 26). Capturas e evidências em ../evidence/27/.

A primeira rodada revelou saída da conta durante carregamento da navegação de histórico, que cancelava a conferência de acesso. Reprodução local falhou; aguardar a biblioteca eliminou o sintoma. Correção: Sair fica desabilitado durante navegação. A sequência original passou depois no desktop/mobile, e a correção foi publicada. Instrumentação temporária removida. Uma rodada posterior teve demora acima de 20 segundos no login após convite (9/10); o caso passou duas vezes isoladamente e a rodada completa final passou 10/10. Falha preservada; causa dessa intermitência não estabelecida, sem alegar ausência de falhas transitórias.

`npm test`: 129/129, 22 arquivos. Build/typecheck, lint, fronteira do bundle e `npm run test:published` aprovados. As senhas de validação ficam em memória/pipe; snapshots de falha preservados foram sanitizados. O smoke não iniciou chamada cobrada de IA. Não foi usado celular físico.

Execução final `20261021-4d6dc9` limpa por IDs exatos. Conferência agregada posterior: zero contas/espaços temporários remanescentes e um administrador real ativo preservado; zero registros locais pendentes. Status final **done**. Ticket 28 desbloqueado, sem início nesta execução.
