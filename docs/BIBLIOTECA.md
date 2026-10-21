# Biblioteca, projetos e títulos

Em **Mapas**, use **Projetos** para criar ou editar um projeto da equipe. Nome e cliente opcional aceitam até 120 caracteres; todos os membros ativos podem criar e renomear. A exclusão de projetos não faz parte desta versão.

Abra um mapa e escolha **Detalhes do mapa** para mudar seu título ou projeto. **Sem projeto** remove a associação. Cada salvamento é uma alteração própria, versionada e compatível com Desfazer/Refazer. Renomear preserva o texto do nó central, os nós, sua autoria e o responsável pelo mapa.

A busca consulta títulos no servidor após 300 ms sem digitação. Projeto/cliente e responsável são filtros combináveis. A URL preserva `q`, `project`, `owner` e `page` para recarga ou compartilhamento com colegas autorizados. Os resultados mostram tabela no desktop e cartões no celular. Falhas mantêm os filtros e oferecem nova tentativa.

Cada página retorna no máximo 20 metadados de mapas; a consulta não carrega nós. A ordenação usa data de atualização decrescente e ID decrescente para desempate. Uma página além do último resultado é ajustada para a última disponível. Como a biblioteca acompanha alterações reais da equipe, mapas editados podem mudar de posição entre consultas; não há uma fotografia congelada durante toda a navegação.

## Transferir responsabilidade

O responsável atual ou um administrador encontra **Novo responsável** em **Detalhes do mapa**. Escolha outro membro ativo da equipe e use **Transferir responsabilidade**. Conclua o salvamento das alterações anteriores primeiro. O responsável exibido muda após a confirmação do servidor; a biblioteca também passa a usar o novo responsável.

Toda a equipe continua podendo editar. A transferência preserva o criador do mapa e a autoria dos nós, fica registrada no servidor e reinicia o histórico da sessão. Ela não é revertida por Desfazer. Uma nova transferência exige novamente responsável atual ou administrador; depois dela, novas edições de conteúdo continuam tendo histórico normal.

Se a resposta se perder, **Tentar novamente** repete a mesma solicitação, inclusive depois de recarregar o navegador. Um destino que deixou de estar ativo é rejeitado. Em conflito com outra sessão, o fluxo existente preserva as alterações locais. Uma negativa de transferência por papel não retira o acesso do colega ao conteúdo.

## Persistência e autorização

- `projects` tem RLS por equipe e somente SELECT para o cliente autenticado. Criação e edição usam `create_project` e `rename_project`; a autoria vem da sessão. Repetir a criação com o mesmo ID e dados não duplica o projeto.
- `maps.project_id` usa FK composta com `workspace_id`, impedindo associação entre equipes inclusive por escrita privilegiada.
- `rename_map` e `set_project` usam a fila durável, revisão esperada, idempotência e snapshots do histórico já existentes. Rascunhos antigos sem `projectId` continuam legíveis. O título local pendente é usado ao recuperar o conteúdo como cópia; esse fluxo cria um novo mapa sem projeto, que pode ser associado pelos detalhes.
- `list_map_library` é SECURITY INVOKER e aplica RLS. Busca trata `%`, `_` e barra invertida como texto literal. Cache inclui pessoa, equipe e todos os filtros; respostas atrasadas pertencem à chave antiga e não substituem a busca atual.
- Índices B-tree cobrem equipe/ordem, projeto/ordem e responsável/ordem; GIN `pg_trgm` atende busca parcial por título. Isso não constitui um benchmark de grandes bibliotecas; otimização geral continua no ticket 24.

Migrações: `20261020023507_projects_and_library.sql` e `20261020025706_transfer_map_owner.sql`, aplicadas uma vez no projeto final Primary. A transferência usa o comando versionado `transfer_owner`, com locks de mapa e vínculos, revisão esperada, idempotência e patch canônico. A API pública continua SECURITY INVOKER, com autorização explícita na função privada. Nenhuma escrita direta de mapas é concedida ao cliente. Tipos gerados do mesmo projeto. Testes reais, capturas e conferências do catálogo estão em `.scratch/mapa-mental/evidence/13` e `evidence/14`.

## Excluir um mapa

Em **Detalhes do mapa**, responsável ou administrador pode usar **Excluir mapa**. A confirmação mostra o título; cancelar antes de confirmar não altera o mapa. Após confirmação do servidor, o app retorna à biblioteca. A exclusão retira o mapa da busca e bloqueia novas edições, consultas de nós, histórico e cópia a partir dele. Os registros ficam retidos no servidor; esta versão não tem lixeira, restauração ou destruição física automática.

Se outra sessão ainda tiver alterações pendentes, o app informa que o mapa foi excluído e preserva o rascunho isolado da pessoa enquanto ela continuar com acesso à equipe. A tela permite exportação de emergência e retorno à biblioteca, sem restaurar o mapa. A exportação verifica novamente o acesso no servidor antes de criar o arquivo. A revogação do vínculo impede o download, oculta a tela e limpa os dados locais da conta.

Se a resposta da sua própria exclusão se perder, o pedido fica guardado. Depois de recarregar, **Confirmar exclusão pendente** repete o mesmo ID, revisão e payload. A confirmação não cria outra exclusão nem devolve o conteúdo retido. O código público continua `NOT_FOUND`; o motivo `MAP_DELETED` só é informado a membros ativos, permitindo preservar o rascunho sem revelar conteúdo a pessoas de fora.

Migrações do ticket 17: `20261020130503_soft_delete_maps.sql` e `20261020130940_recheck_deleted_map_after_lock.sql`. A segunda revalida a classificação após uma espera por lock concorrente. RLS existente de mapas, nós e preferências continua exigindo mapa ativo. Operações futuras de IA também devem verificar mapa ativo ao iniciar e aplicar; nenhuma função de IA foi disponibilizada nesta fatia.

## Duplicar um mapa

Qualquer membro ativo encontra **Duplicar mapa** em **Detalhes do mapa**. Conclua o salvamento antes de confirmar. O servidor lê uma versão coerente do original, cria um mapa independente e o app abre a nova URL após a confirmação. A cópia mantém textos, estrutura, ordem e projeto. O título recebe ** — cópia**, com limite de 120 caracteres; responsável, criador e último editor dos novos registros passam a ser quem solicitou a cópia. Todos os nós começam como manuais, mesmo quando a origem veio de IA.

Histórico, jobs de IA e preferências de visualização não são clonados. Editar/excluir na cópia não afeta o original; excluir o original depois não tira o acesso à cópia. A referência de origem fica apenas como informação na operação interna de criação (`sourceMapId` e `sourceRevision`), sem autorizar leituras ou edições.

Uma falha mantém a URL e a seleção do original. A tentativa pendente guarda somente seu identificador no armazenamento da aba, isolado por conta/equipe/mapa, e repete a mesma operação após recarga. Se o original mudar nesse intervalo, a confirmação retoma a cópia da primeira solicitação, como indicado na tela. Sem conseguir guardar esse identificador, o app informa a falha de armazenamento antes de enviar o pedido. A autorização e o estado ativo da origem são conferidos também nas repetições; uma origem excluída ou acesso revogado não permite iniciar/repetir a cópia. Depois da confirmação, voltar ao original e duplicar novamente representa uma nova cópia intencional.

Esse fluxo difere de **Salvar minha versão como cópia**, da recuperação de conflito: a recuperação usa os textos locais e cria um mapa sem projeto, enquanto a duplicação normal usa exclusivamente o snapshot remoto e mantém o projeto. Ambos compartilham a mesma primitiva privada para gerar IDs, remapear pais e inserir mapa/nós/operação atomicamente. As duas entradas validam a árvore inteira, com até 500 nós e profundidade 30. Migrações do ticket 16: `20261020133059_duplicate_remote_map.sql` e `20261020133607_validate_copy_snapshot.sql`, aplicadas no Primary; API pública `duplicate_map` invoker, implementação privada com sessão e autorização explícitas, sem escrita direta para clientes.
