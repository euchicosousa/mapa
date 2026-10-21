# Convites da equipe — ticket 04

Em `/equipe`, administradores ativos enviam, revogam e reenviam convites. Outros membros veem apenas a lista de pessoas. O destinatário entra como membro; convite não concede papel de administrador.

## Entrada e aceite

Para um endereço novo, a função `manage-invitation` reserva o convite e usa `inviteUserByEmail` com o SMTP Resend já configurado. O link verifica o e-mail e abre a definição de senha do ticket 03. Depois de salvar a senha e entrar, a pessoa encontra o convite em `/sem-acesso` e escolhe **Aceitar convite**. Autenticar pelo link, por si só, não concede vínculo.

Para uma conta existente, o convite é registrado e o administrador recebe a orientação para a pessoa entrar com sua senha e aceitar. Não é enviado um falso “novo convite” pelo Auth. Uma identidade já convidada, ainda sem confirmação, pode receber reenvio pelo mesmo método administrativo. A API nunca devolve uma listagem de usuários Auth.

O convite vale por sete dias; o reenvio/renovação explícita restaura essa validade e exige 60 segundos desde a última tentativa. Uma solicitação duplicada de criação retorna o convite pendente existente sem enviar outra mensagem. A lista distingue envio confirmado, conta existente, falha, envio ainda não confirmado, aceite, vencimento e revogação. Uma falha de confirmação do banco após o envio fica incerta; o app não afirma sucesso.

## Autorização e concorrência

`workspace_invitations` tem RLS e leitura direta somente por administradores ativos da própria equipe. O browser não escreve na tabela nem chama as funções administrativas, que têm execução exclusiva do serviço.

A Edge Function valida o JWT com `getUser` e deriva o ator dessa identidade. O banco confere novamente o papel ativo antes da reserva. A reserva serializa operações por equipe, normaliza o endereço, evita convites pendentes duplicados e emite um claim para o envio. Finalização só registra o resultado correspondente ao claim; nunca altera pending/accepted/revoked, de modo que uma resposta tardia de SMTP não restaura um convite revogado.

O destinatário recebe apenas os próprios convites válidos por uma RPC que consulta seu e-mail confirmado em `auth.users`. Aceitar usa a identidade autenticada, checa confirmação, endereço, vínculo de identidade quando disponível, prazo e estado, e cria o vínculo em uma transação. O lock da pessoa serializa aceites concorrentes; o lock do convite ordena aceite/revogação. Repetir o aceite retorna o mesmo vínculo, sem duplicá-lo ou restaurar um acesso desativado depois. Convite vencido/revogado não concede acesso mesmo quando a pessoa tem uma sessão Auth válida.

A interface atual suporta uma equipe ativa por conta. Uma conta já vinculada a uma equipe ativa não recebe novo convite para criar um segundo vínculo. Reativar uma pessoa por convite estabelece o papel de membro; gestão de desativação pertence ao ticket 15. Nenhum papel ou vínculo vem de user_metadata editável.

As RPCs públicas são SECURITY INVOKER; o privilégio intencional fica em funções privadas com search_path fixo, nomes qualificados e ACL específica. Chave de serviço fica somente na Edge Function e nas ferramentas administrativas de validação.

## Configuração e publicação

Função `manage-invitation`, JWT obrigatório no gateway e identidade validada no handler. Usa `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` fornecidos pelo ambiente do projeto; nenhuma nova chave externa foi necessária. Deploy remoto por API, sem Docker.

Os retornos locais aceitos pela função são `/auth/callback` em `127.0.0.1:5173`, `localhost:5173`, `127.0.0.1:4174`, `127.0.0.1:4173` e `localhost:4173`. O destino precisa também constar nos redirects do Supabase Auth. Na publicação, configurar `MAPA_AUTH_CALLBACK_URLS` na função com os callbacks locais que devam permanecer e o callback HTTPS público, além de atualizar a lista de Auth. Nunca aceitar um redirect arbitrário informado pelo browser. O origin que chama a API não concede autorização: ela depende sempre de JWT e papel no banco.

E-mails mantêm o template padrão do Supabase; não há envio comercial nem provedor paralelo.

## Verificação e operação

- `npm test`: entrada do handler e adaptador de entrega, incluindo falha de transporte, conta existente e confirmação perdida. Respostas artificiais existem somente nos testes.
- `tests/integration/invitations.sql`: asserts com rollback integral no banco final.
- `node --test tests/integration/invitations.test.mjs`: API real, privacidade, não administradores, cooldown, expiração/revogação e dois aceites HTTP concorrentes.
- `npm run test:e2e:auth -- invitations.spec.ts`: interface em desktop/mobile, destinatários temporários independentes. Uma falha registrada de envio é inserida apenas como fixture na execução identificada para conferir sua apresentação e retomada; não se altera SMTP real para produzir uma falha.
- `MAPA_INVITATION_EMAIL=ochicosousa@gmail.com node scripts/validate-invitation-mail.mjs`: smoke manual explicitamente autorizado com novo destinatário, UI administrativa, e-mail real, definição de senha e aceite em outro contexto. O executor lê o link exato recebido e o encaminha a `/private/tmp/mapa-invitation-mail-link.json`, privado (600), sem imprimi-lo. O script remove esse arquivo e limpa recursos por IDs. Não rodar sem autorização da caixa.

Se um envio ficar sem confirmação, conferir a lista e tentar novamente após o cooldown. Não apagar a conta Auth para reenviar. Para renovar um convite vencido, usar o controle da lista. Para impedir o ingresso, revogar o convite; após aceite, a desativação de acesso é uma ação distinta, disponível no ticket 15 e documentada em [ACESSO-MEMBROS.md](ACESSO-MEMBROS.md).

Referências: [inviteUserByEmail](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [segurança de Edge Functions](https://supabase.com/docs/guides/functions/auth), [fluxos de senha do projeto](AUTH-LINKS.md).
