# 35: Migrar a autenticação para o fluxo PKCE

**What to build:** Trocar o fluxo `implicit` do Supabase Auth pelo PKCE, para que tokens de sessão não passem pela URL.

**Blocked by:** nenhum.

**Status:** ready-for-agent — divisão aprovada pelo usuário em 21/10/2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Contexto

`src/lib/supabase.ts` usa `flowType: 'implicit'`. Os links de recuperação de senha e de convite chegam com `access_token` e `refresh_token` no fragmento da URL, lidos por `src/auth/password-links.ts` e aplicados com `setSession`. Para SPAs, o recomendado hoje é PKCE ou links com `token_hash` verificados por `verifyOtp`, evitando tokens na URL e no histórico do navegador.

## Implementação definida

1. Mudar o cliente para `flowType: 'pkce'`.
2. Alterar os templates de e-mail de convite e de recuperação no Supabase para enviar `token_hash` e `type` para `/auth/callback`.
3. Reescrever `password-links.ts` para ler `token_hash` e `type` da query e chamar `supabase.auth.verifyOtp`, mantendo a limpeza da URL e os estados de link inválido ou expirado.
4. Conferir que `manage-invitation` (que usa `inviteUserByEmail`) continua gerando links válidos com o novo template.
5. Atualizar `docs/AUTH-LINKS.md`.

## Critérios de aceite

- [ ] Nenhum token de sessão aparece na URL em nenhum fluxo (login, recuperação, convite).
- [ ] Recuperação de senha e aceite de convite funcionam ponta a ponta com e-mail real (`scripts/validate-password-mail.mjs` e `scripts/validate-invitation-mail.mjs`).
- [ ] Links antigos, inválidos ou já usados mostram a tela de link inválido, sem erro técnico.
- [ ] `npm run test:e2e:auth` passa.

## Como verificar

Scripts de validação de e-mail, suíte `test:e2e:auth` e conferência manual da URL após cada fluxo.

## Limites desta entrega

Sem mudar telas além do necessário para os novos estados.

## Dependências externas

Acesso aos templates de e-mail do projeto Supabase final; caixa de e-mail real para os testes; janela combinada com o usuário, porque links enviados antes da troca deixam de funcionar.

## Registro do executor

Pendente.
