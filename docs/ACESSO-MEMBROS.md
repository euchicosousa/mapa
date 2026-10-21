# Acesso de membros — ticket 15

Em `/equipe`, administradores ativos podem desativar ou reativar pessoas após confirmação. A operação altera apenas o status do vínculo. Não apaga usuário Auth, perfil, mapas, nós ou histórico; também não altera o papel da pessoa.

## Proteções

- O último administrador ativo não pode ser desativado. A decisão é serializada por equipe, inclusive quando dois administradores tentam sair simultaneamente.
- Uma pessoa responsável por mapas não excluídos precisa transferi-los antes de perder acesso. A resposta bloqueada lista somente IDs/títulos autorizados da equipe, com links para o fluxo de transferência existente.
- Mapas novos e atribuições/restaurações de responsabilidade exigem responsável ativo. Um trigger privado retém lock compartilhado no vínculo do responsável; a desativação obtém o lock exclusivo antes de conferir os mapas. Isso ordena transferências/criações concorrentes sem bloquear linhas de mapa na operação de acesso e evita ciclos entre locks de mapa e membro.
- Membro comum, pessoa inativa e usuário externo não reativam contas ou mudam papéis pela API. Não há endpoint de promoção de papel no browser. Reativação administrativa preserva o papel existente; reativação por convite continua seguindo o contrato do ticket 04.
- Uma conta não é reativada em segunda equipe enquanto houver outro vínculo ativo, conforme a interface de equipe única. O lock por identidade é compartilhado com o aceite de convite.

`set_member_access` é uma RPC pública SECURITY INVOKER; a implementação elevada fica em schema privado, com search_path fixo, ACL restrita, auth.uid e administrador ativo revalidado sob lock. A lista de mapas bloqueadores é calculada pelo servidor. A UI não é fronteira de autorização.

## Token anterior e navegador aberto

RLS e RPCs consultam o vínculo atual no banco. Um JWT emitido antes da desativação ainda pode identificar uma conta válida no Auth, mas já não autoriza ler ou escrever dados da equipe. Não se promete exclusão ou revogação global de sessões Auth.

Ao voltar à aba/recuperar foco, o cliente revalida o acesso quando o roteador está ocioso. A solicitação é aguardada, em vez de descartada quando há ação/navegação em andamento. A negativa de acesso do editor oculta o documento imediatamente e também agenda essa revalidação. Confirmada a ausência de vínculo ativo, o fluxo existente apaga os caches privados e os rascunhos da conta, sem oferecer cópia na equipe revogada.

Não há canal realtime de revogação: a verificação ocorre ao recuperar foco ou fazer a próxima operação/revalidação. A fronteira de acesso permanece no servidor, mesmo enquanto uma tela antiga está aberta.

## Verificação

- `npm run test:members`: sete cenários com Auth/banco reais e identidades temporárias. Token anterior, bloqueadores, autoria, reativação sem promoção, dois administradores concorrentes, três disputas transferência × desativação e criação × desativação, além de convite antigo × autodesativação.
- `npm run test:e2e:auth -- member-access.spec.ts`: desktop 1440×900 e mobile 390×844; confirmação, último admin, mapas a transferir, transferência, remoção/retorno do acesso e editor aberto. Confere limpeza de IndexedDB/caches após foco e após escrita negada sem evento de foco.
- `npm test`: inclui revalidação adiada durante navegação/ação e limpeza dos listeners, além da suíte existente.
- `npm run test:rls`: regressão do domínio e isolamento no mesmo projeto final.

Os testes usam apenas recursos identificados da própria execução e limpam os IDs registrados. Nenhuma conta real tem seu acesso alterado. Ferramentas administrativas com a chave de serviço continuam privilegiadas e devem ser usadas apenas dentro de seu escopo; a UI utiliza a RPC validada, nunca atualização direta de membership.

Migração e evidências estão no ticket 15 do tracker local. Para entender a fronteira de acesso, consultar [RLS no Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
