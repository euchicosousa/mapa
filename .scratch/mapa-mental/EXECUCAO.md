# Guia do executor

## Entrada

Ler este guia e o ticket solicitado. Ler o contrato técnico antes da primeira implementação; em retomadas, reler as seções afetadas. Consultar os bloqueadores para identificar contratos existentes. O plano do app explica o produto; o contrato deste pacote resolve detalhes de implementação.

A divisão foi aprovada explicitamente pelo usuário em 19 de outubro de 2026: “Aprovo sim”. Os 28 tickets e o manifesto estão ready-for-agent. Não solicitar novamente aprovação da divisão; verificar somente os bloqueadores e as entradas externas da fatia a executar.

## Revisão visual do ticket 01

O usuário pediu Swiss Design após a primeira entrega. O ticket 01 foi reaberto como ready-for-agent; retomar a implementação existente e aplicar os critérios adicionais. Ler a seção visual do contrato. Preservar evidências anteriores como histórico e registrar novas evidências. Só retornar a done após verificar o ajuste. A mesma direção visual é obrigatória nos tickets seguintes: escala neutra com cinzas intermediários permitidos. Cantos retos do shell não obrigam os nós; formato personalizável do mapa fica para depois.

## Estados

- draft: especificação escrita, divisão ainda não aprovada.
- ready-for-agent: aprovada; pode iniciar somente com todos os blocked_by em done.
- in-progress: execução iniciada.
- blocked: falta entrada externa, decisão realmente contraditória ou infraestrutura necessária; registrar motivo exato e trabalho já feito.
- done: todos os critérios do ticket verificados com evidência.

O estado do ticket e do manifesto devem coincidir. Não tratar ready como ausência de bloqueadores.

## Procedimento por ticket

1. Confirmar aprovação e bloqueadores. Abrir implementação já existente e reutilizar componentes/operações do domínio. Se o código divergir do contrato, registrar divergência e corrigir dentro do escopo; não criar segunda implementação paralela.
2. Marcar in-progress. Executar a entrega vertical inteira: comportamento, autorização/persistência quando aplicável, interface desktop/mobile e verificações especificadas.
3. Seguir skills aplicáveis, especialmente Supabase para schema, Auth, RLS e Edge Functions. Consultar documentação correspondente às versões instaladas; não alterar stack ou regras de produto por preferência pessoal.
4. Rodar verificações do ticket e checks gerais pertinentes. Para mudança no banco, migração versionada no projeto Supabase final, conferência de histórico e testes delimitados com identidade autorizada e não autorizada; sem reset. Para interface, verificar ambos os tamanhos; mock de testes não comprova integração real.
5. Registrar comandos executados, resultados, comportamento e limitações no ticket. Marcar done apenas com todos os critérios atendidos. Se testes essenciais não rodaram, marcar blocked e explicar como retomar. Sincronizar manifesto.
6. Encerrar com resumo breve e próximo ticket desbloqueado. Continuar em outro ticket apenas se a instrução do usuário tiver autorizado execução sequencial.

## Regras de escopo

- O planejamento já definiu IA com inserção direta; não introduzir etapa de aceite.
- Autenticação, banco e identidades ficam no Supabase. Não criar sistema paralelo de senha ou autorização só no frontend.
- Mobile é obrigatório em cada fatia com UI; o ticket final de acessibilidade não autoriza adiá-lo.
- Todos os membros ativos editam; owner limita somente transferência/exclusão de mapa. Autoria do nó nunca muda por edição posterior.
- Segredos ficam no ambiente adequado, não em arquivos de tickets, logs ou bundle. Configuração ausente bloqueia integração real, não autoriza resultado simulado.
- Suporte a IA requer adaptador, job idempotente e commit validado no servidor. Browser não consegue marcar um nó manual arbitrário como source=ai.
- Não implementar features futuras nem mudar domínio para facilitar biblioteca. Se limite técnico real exigir alteração, apresentar evidência antes de modificar contrato.
- Um único projeto Supabase final desde o ticket 02. Sem Docker, banco local ou staging. Testes de integração/concorrência usam recursos identificados no mesmo projeto, conforme seção 7 do contrato; não usar seeds locais, reset nem contas reais da equipe para testes que alteram acesso.

## Prompt sugerido para iniciar após aprovação

Execute o ticket 01 do pacote .scratch/mapa-mental. Leia o guia de execução e o contrato técnico. Respeite as decisões e os critérios do ticket, verifique desktop e mobile, registre evidências e atualize o ticket e o manifesto. Não avance para o próximo ticket nesta execução.

Para os seguintes, trocar somente o número e conferir bloqueadores.

## Retomada do ticket 02

O usuário substituiu o ambiente local pelo projeto final único. Ticket 02 foi liberado para adaptar scripts/configuração/testes. Preservar a base entregue, ler docs/AUTH-SUPABASE.md e verificar entradas remotas necessárias. Não reinstalar o bloqueio por Docker ou criar staging.
