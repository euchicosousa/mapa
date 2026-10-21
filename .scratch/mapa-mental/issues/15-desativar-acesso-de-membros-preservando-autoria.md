# 15: Desativar acesso de membros preservando autoria

**What to build:** Administrador remove acesso de um membro sem apagar os mapas e nós que ele criou.

**Blocked by:** 04: Convidar uma pessoa para entrar na equipe; 14: Transferir responsabilidade sem restringir a edição

**Status:** done — concluído em 20/10/2026 com API real, concorrência e editor aberto em desktop/mobile.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Tela equipe oferece desativar/reativar membro, protegida por admin no servidor. Papel só muda por operação administrativa; impedir remover último admin.
2. Bloquear desativação de pessoa que ainda responde por mapas ativos, listando os mapas autorizados que precisam ser transferidos. Revalidar condição e transferências em transação com locks consistentes.
3. RLS consulta vínculo ativo ao vivo, não depende de JWT com papel antigo. Solicitação com token ainda válido do desativado é negada.
4. Ao recuperar foco ou receber FORBIDDEN, cliente revalida acesso, oculta mapa e limpa caches/rascunhos privados. Perfis continuam para autoria histórica.

## Critérios de aceite

- [x] Desativado perde leitura/escrita via API mesmo com token anterior.
- [x] Nós/mapas antigos mantêm criador identificável.
- [x] Último admin e responsável por mapa ativo não podem ser desativados.
- [x] Membro comum não se promove ou reativa pela API.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Integração com token prévio à revogação e duas requisições concorrentes; E2E cliente aberto durante revogação.

## Limites desta entrega

Não excluir usuário do Auth nem implementar transferência em massa automática.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Concluído em 20/10/2026, com a UI atual preservada:

- Administrador desativa/reativa pelo perfil na equipe, após confirmação. RPC valida identidade e papel ativo no banco; altera somente status do vínculo, sem permitir mudar papel nem excluir Auth/perfil/documentos/autoria/histórico.
- Último administrador ativo é protegido sob lock da equipe. Dois pedidos concorrentes de autodesativação deixaram um administrador ativo.
- Responsável por mapas não excluídos recebe bloqueio com lista autorizada de títulos/links. A transferência existente resolve a responsabilidade antes da desativação.
- Atribuir/criar/restaurar mapa exige responsável ativo, por trigger privado que retém lock compartilhado no vínculo. Desativação usa lock exclusivo e leitura sem lock das linhas de mapa; corridas de transferência/criação não deixaram mapa sob responsável inativo.
- Reativação preserva papel e impede vínculo ativo em segunda equipe. Ordem de lock por identidade alinhada ao aceite de convite, incluindo convite antigo após reativação administrativa.
- Token emitido anteriormente continuou identificando a conta no Auth, mas perdeu leitura/escrita da equipe imediatamente após desativar. Não há exclusão de usuário nem promessa de revogação global de JWT.
- Foco/retorno à aba revalidam acesso quando o roteador estiver ocioso, sem descartar verificação por uma ação em andamento. Negativa de acesso no editor oculta o documento e sinaliza revalidação; ausência de vínculo limpa caches/rascunhos de toda a conta e não oferece cópia na equipe revogada.

Migrações aplicadas e conferidas no projeto final `bodxafqkqlyfoyfgahyj`:

- `20261020202313_member_access.sql`.
- `20261020204641_member_access_lock_order.sql`.

RPC pública SECURITY INVOKER, implementação/trigger elevados somente em schema privado, search_path fixo e ACL explícita. Tipos gerados do projeto real. Não houve mudança de SMTP, chamada de IA, novo ambiente ou publicação.

Verificações:

- Typecheck, lint, build e proteção do bundle: passaram.
- `npm test`: **102/102** em 17 arquivos, incluindo revalidação adiada por navegação/ação e descarte de listeners.
- `npm run test:members`: **7/7** no projeto real. Papéis/anon/externos, bloqueadores, token anterior, perfil/autoria preservados, reativação, dois administradores concorrentes, três corridas transferência × desativação, criação × desativação e três corridas convite antigo × autodesativação.
- `npm run test:rls`: **46/46**. A execução remota apresentou esperas longas de rede/Auth, mas terminou sem falhas; sem repetir a suíte inteira após sucesso.
- `npm run test:e2e:auth -- member-access.spec.ts`: **2/2**, 1440×900 e 390×844. Confirmação, bloqueio de último admin, lista de mapas e transferência, desativar/reativar, autoria e editor aberto. Verificadas remoção do canvas, limpeza de IndexedDB e zero caches privados tanto ao receber foco quanto após escrita negada sem evento de foco. Execução `20261020-47a397`, limpa.
- Capturas desktop/mobile inspecionadas; ações funcionam por toque, sem overflow. Não houve teste em telefone físico.
- Advisors sem problemas novos: permanecem informações de RLS em tabelas internas fechadas e o aviso preexistente de proteção contra senha vazada.
- SQL final: zero workspaces/identidades de validação restantes, duas migrações do ticket e ausência de permissão anônima na RPC. `.validation-runs` vazio; servidor temporário encerrado. Acesso e dados reais preservados.

As primeiras verificações corrigiram pressupostos dos testes: autoria do mapa é consultada no campo real do banco, texto Salvo inclui um ícone e o próprio autor é apresentado como “você”. Os fluxos completos foram repetidos com sucesso. Uma revisão automática para iniciar a repetição expirou; a repetição autorizada posterior executou normalmente, sem bloqueio restante.

Operação: [docs/ACESSO-MEMBROS.md](../../../docs/ACESSO-MEMBROS.md). Evidências: [evidence/15/README.md](../evidence/15/README.md).

Limites: não há push realtime de revogação. A API nega o acesso pelo estado atual do banco; a tela aberta reage ao recuperar foco ou realizar nova operação/revalidação. Ferramentas com chave de serviço permanecem privilegiadas e não fazem parte do caminho do browser. Próximo ticket: **21**, único próximo desbloqueado. Nenhum trabalho do 21 iniciado.
