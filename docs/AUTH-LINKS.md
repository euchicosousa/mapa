# Recuperação e links de acesso — ticket 03

## Fluxo no app

`/recuperar-senha` solicita um e-mail pelo SDK Supabase. O resultado não informa se o endereço existe. Erros de conexão e excesso de solicitações oferecem nova tentativa. O SMTP Resend já está configurado no projeto final, com o remetente MAPA <nao-responder@auth.cnvt.com.br>.

O SDK usa explicitamente `flowType: 'implicit'`, adequado a esta SPA client-only. O e-mail mantém o `ConfirmationURL` padrão do Supabase: a verificação acontece no Auth e redireciona a `/auth/callback` com uma sessão no fragmento. Não existe dependência de um verificador PKCE no aparelho solicitante. Um convite também usa esse callback; criar convites e conceder vínculo à equipe pertence ao ticket 04.

Antes de iniciar o roteador, o app captura apenas fragmentos completos dos tipos `recovery` e `invite` e limpa fragmento/query da URL com `replaceState`. A captura também cobre navegação por fragmento na mesma página. Erros do provedor nunca são exibidos literalmente. `detectSessionInUrl` permanece desabilitado para evitar dois consumidores concorrentes. O SDK `setSession` valida a identidade no servidor; somente uma sessão válida habilita `/definir-senha`.

Um marcador local contém apenas ID da conta e validade de até 30 minutos (limitado pela validade da sessão), sem tokens adicionais. Ele fica em sessionStorage e permite recarregar o formulário na mesma aba. É comparado com `getUser` antes de mostrar o formulário e antes da alteração. Um login comum ou outra conta não substitui o consumo do link. Esse marcador é controle de fluxo da interface; a autorização continua sendo a sessão validada pelo Supabase.

A nova senha é salva com `updateUser`, com confirmação e validação local de 6–1.024 caracteres. A política atual do projeto é mínimo 6, sem requisitos extras; o servidor também valida a política e retorna erros de senha fraca/repetida. Ao mudar a política administrativa, atualizar os requisitos apresentados em `password-actions.ts`. Após salvar, remover o marcador e encerrar a sessão local para entrar com a nova senha. Se a saída falhar, informar que a senha foi salva e orientar a saída pela navegação, sem afirmar que a sessão acabou.

Links sem sessão válida, expirados ou reutilizados apresentam uma nova solicitação sem redirecionamentos em loop. Nenhum token entra em loader data, formulário, mensagem de erro ou log do app. A página declara `Referrer-Policy: no-referrer` por meta. O armazenamento de sessão permanece gerenciado pelo SDK.

## Configuração remota

Projeto único: `bodxafqkqlyfoyfgahyj`. Site URL atual (ticket 26): `https://mapa.cnvt.com.br`; o callback HTTPS exato foi acrescentado, preservando os destinos locais. A lista remota permite callbacks exatos em localhost/127.0.0.1 nas portas 5173 e 4173 e o callback de validação em 127.0.0.1:4174. O destino preexistente `http://127.0.0.1:4174` foi preservado.

`scripts/auth-config/supabase/config.toml` é uma configuração **parcial** revisável. Usar `supabase config diff --workdir scripts/auth-config --project-ref bodxafqkqlyfoyfgahyj` antes de qualquer push. Esse arquivo declara somente Site URL e redirects; não modifica SMTP, segredos ou outros controles remotos. Não enviar o config completo de desenvolvimento para substituir a configuração do projeto.

A URL de produção foi definida no ticket 26 como `https://mapa.cnvt.com.br`; Site URL/lista foram atualizados. A publicação da SPA e a conferência na URL acessível pertencem ao ticket 27. Em um aparelho físico, localhost aponta para o próprio aparelho: para uso entre aparelhos é necessário um frontend acessível e autorizado na lista de redirects. A validação deste ticket usa contextos de navegador independentes com viewport desktop/mobile; não equivale a um teste em telefone físico.

## Verificação

- `npm test`: parser, consumo, grant/expiração/troca de conta, resposta genérica, erros seguros e alteração de senha pelo SDK.
- `npm run test:e2e:auth -- password.spec.ts`: seis cenários contra Auth real, em 1440×900 e 390×844. Links reais gerados administrativamente para contas descartáveis; sem simular a API. Cobrem recovery/invite, novo navegador, recarga, senhas divergentes, nova senha no login, reuso, erros e remoção dos tokens.
- `MAPA_PASSWORD_EMAIL=ochicosousa@gmail.com node scripts/validate-password-mail.mjs`: execução manual explícita com a caixa autorizada, criação recusada se a conta já existir, solicitação pela UI, consumo do link recebido em contexto mobile e entrada em um terceiro contexto. O executor encaminha o link exato do e-mail para `/private/tmp/mapa-password-mail-link.json`, privado (600), sem imprimi-lo. O script remove esse arquivo e somente os IDs registrados na própria execução. Não rodar sem autorização da caixa destinatária.

Evidências e resultados em `.scratch/mapa-mental/evidence/03/README.md`. Contas reais da equipe e suas senhas são preservadas.

Referências conferidas: [fluxo implicit](https://supabase.com/docs/guides/auth/sessions/implicit-flow), [resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [setSession](https://supabase.com/docs/reference/javascript/auth-setsession). A mudança recente de remoção de cifras CBC não exige alteração neste cliente moderno; os testes reais de Auth passaram.
