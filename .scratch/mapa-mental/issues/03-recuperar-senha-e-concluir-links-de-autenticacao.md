# 03: Recuperar senha e concluir links de autenticação

**What to build:** A pessoa recupera acesso ou define senha a partir de um link válido no computador e no celular.

**Blocked by:** 02: Entrar com Supabase Auth e reconhecer a equipe

**Status:** done — concluído em 20/10/2026, com Supabase/Resend reais e validação desktop/mobile.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Implementar /recuperar-senha, /auth/callback e /definir-senha usando o fluxo client-only suportado pela versão fixada do Supabase. Cobrir links recovery e invite, inclusive quando abertos no celular a partir de outro aparelho.
2. Escolher e documentar fluxo de token compatível com esses links; não depender de verificador PKCE inexistente no aparelho receptor. SDK deve consumir sessão, remover tokens da URL e não registrá-los.
3. Resposta de solicitação de recuperação é genérica. Link inválido/expirado oferece nova solicitação. Formulário de senha segue requisitos configurados no Auth e confirma repetição.
4. Configurar no Supabase final redirects para o frontend local e a URL publicada quando disponível. Testar recebimento real em caixa de e-mail autorizada; configurar envio do projeto nesta etapa, sem depender de capturador local.

## Critérios de aceite

- [x] Link recovery válido permite salvar nova senha e entrar com ela.
- [x] Link expirado não define senha nem entra em loop de redirecionamento.
- [x] Tokens somem da URL após consumo e não aparecem em logs.
- [x] Fluxo funciona em contexto de navegador diferente daquele que pediu recuperação.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

E2E com e-mail real autorizado e conta dedicada de validação, troca real de senha e link inválido; viewport mobile com teclado.

## Limites desta entrega

Entrega de e-mail Auth no projeto final é requisito deste ticket. Configurar SMTP quando necessário; não aguardar a etapa de publicação nem simular e-mail recebido.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Implementado em 20/10/2026, preservando a UI atual:

- Rotas reais `/recuperar-senha`, `/auth/callback` e `/definir-senha`; resposta genérica na solicitação, confirmação de senha, erros recuperáveis e entrada com a nova senha após saída local.
- Fluxo implicit explícito no SDK 2.118.0: os links recovery/invite padrão do Supabase funcionam em contexto separado, sem verificador PKCE do solicitante. Tokens são capturados em memória e removidos da URL antes do roteador; mudanças de fragmento na mesma página também são tratadas. SDK valida a sessão. Marcador sem tokens, associado à conta e limitado a 30 minutos/validade da sessão, permite recarga do formulário. Login comum não habilita essa tela.
- Link inválido/expirado/reutilizado oferece nova solicitação sem loop. Mensagens não mostram detalhes/tokens do provedor. Meta no-referrer adicionada. Campos são preservados durante revalidação das páginas públicas de Auth; dados privados continuam sujeitos à barreira de privacidade.
- Site URL remoto corrigido de localhost:3000 para http://127.0.0.1:5173 e callbacks exatos autorizados. Push parcial alterou somente Site URL e redirects; SMTP e outros controles preservados. Releitura confirmou zero diferenças nas propriedades declaradas. Nenhuma migração ou alteração de schema.
- Política atual de senha: mínimo 6 caracteres, sem requisitos adicionais; validação do servidor preservada.

Verificações:

- `npm run typecheck`, `npm run lint`: passaram.
- `npm test`: **95/95** em 15 arquivos.
- `npm run build`, `npm run test:bundle`: passaram. Avisos preexistentes de chunk e anotações Zod permanecem.
- `npm run test:e2e:auth -- password.spec.ts`: **6/6** contra Auth real em 1440×900 e 390×844; recovery/invite, outro navegador, recarga, confirmação divergente, login com nova senha, link reutilizado e erro otp_expired, fragmentos incompletos e limpeza de URL.
- `npm run test:e2e:auth -- login.spec.ts --grep 'A has real|wrong password|switching A'`: **6/6**, regressão desktop/mobile de entrada, saída, erro de senha e troca de conta.
- E-mail real autorizado: pedido no desktop para ochicosousa@gmail.com, recebimento no Gmail, consumo do link exato em contexto mobile novo, troca real de senha, login em terceiro contexto e rejeição de reutilização. Execução `20261020-261eee`, limpa. Prova em `evidence/03/real-email.json`.
- Capturas desktop/mobile inspecionadas; formulário e botões visíveis, sem overflow. Não foi utilizado telefone físico.
- Limpeza SQL conferida: zero identidades das execuções do ticket e ausência da identidade temporária Gmail. `.validation-runs` vazio após os testes. Contas e dados reais preservados.

As primeiras execuções identificaram perda de campos na revalidação e falta de captura de fragmento em navegação na mesma página; ambas corrigidas e os seis E2E repetidos integralmente. A primeira tentativa de consumo do e-mail real incluiu um colchete na extração automática do endereço; foi limpa e repetida com o link exato, com sucesso.

Evidências: [evidence/03/README.md](../evidence/03/README.md). Operação e referências: [docs/AUTH-LINKS.md](../../../docs/AUTH-LINKS.md).

Limites: o template SMTP padrão permanece em inglês. URL de produção entra no ticket 26 quando definida; localhost não é acessível de um telefone físico externo. O fluxo foi comprovado em contextos de navegador independentes com viewport mobile. Criação de convites/vínculo à equipe pertence ao ticket 04; a conclusão do link invite já está validada. Próximo recomendado: **04**, agora desbloqueado. Nenhum trabalho do 04 foi iniciado.
