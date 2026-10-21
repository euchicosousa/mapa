# Tickets — app de mapas mentais

28 tickets completos em arquivos individuais, do projeto vazio à versão funcional publicada. Tracker local neste pacote. Status atual: **01–25 done** (25/28). Recuperação, convites e desativação/reativação de acesso concluídos com integrações reais e suporte desktop/mobile. IA real liberada para membros ativos com cancelamento, retomada, cotas atômicas e falhas recuperáveis; orçamento aprovado de 50.000 tokens/dia UTC/workspace. Acessibilidade por teclado/toque e amostra assistida de VoiceOver concluídas. Desempenho medido e otimizado em 200/500 nós, com metas de laboratório atingidas e limites documentados. Isolamento/autoria/integridade verificados com JWTs reais, advisors e catálogo remoto; risco residual de senhas vazadas documentado. Próximo desbloqueado: **26**, conforme bloqueadores do manifesto. Restam três tickets.

Prioridade atual definida pelo usuário em 20/10/2026: encerrar a parte funcional antes do redesenho de UI. Preservar a aparência atual, acrescentando somente controles necessários e corrigindo problemas que impeçam o uso desktop/mobile.

## Ajuste visual aprovado pelo usuário

Swiss Design é obrigatório desde o ticket 01. A paleta atual usa #fafafa, #121212 e cinzas intermediários; cores semânticas e cores dos mapas ficam para depois. Cantos retos se aplicam ao shell; pílulas dos nós são permitidas, com definição/personalização em etapa posterior. A especificação completa está no contrato técnico. Reabrir o ticket não invalida a funcionalidade entregue; adiciona critérios visuais ainda pendentes.

## Como revisar

A lista numerada abaixo contém título, bloqueadores reais e entrega demonstrável. Avaliar se a granularidade está adequada, se as dependências fazem sentido e se alguma fatia deve ser dividida ou unida. A divisão foi aprovada e os estados dos tickets e do manifesto já foram atualizados. Ready indica especificação aprovada; só executar quando todos os bloqueadores estiverem done.

## Sequência recomendada (revisada em 19 de outubro de 2026)

**Por que revisar:** os bloqueadores do manifesto estão corretos e a numeração é uma ordem de dependências válida. Mas a numeração ignora as **entradas externas**. O ticket 03 não depende de outro ticket além do 02; ele depende de envio real de e-mail (SMTP próprio no Supabase e uma caixa de entrada autorizada para teste). Seguindo 03 → 04 em ordem numérica, o trabalho para logo no início esperando configuração externa, enquanto o núcleo do editor (05–12) não precisa de nada externo. Além disso, o SMTP aparece como dependência do ticket 26, embora 03 e 04 precisem dele antes. Nenhum bloqueador foi alterado; muda só a ordem de execução, agrupada por fase.

| Fase | Ordem | Precisa de algo externo? |
| --- | --- | --- |
| A. Núcleo do editor | 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 | Não. Só o projeto Supabase já configurado. |
| B. Gestão de mapas | 13 → 14 → 17 → 16 → 18 → 19 | Não. |
| C. Acesso da equipe | 03 → 04 → 15 | Sim: SMTP próprio configurado no Supabase, remetente e uma caixa de e-mail real para os testes. 15 também exige 14 (fase B). |
| D. IA | 20 → 21 → 22 | Sim: OPENAI_API_KEY como segredo das Edge Functions, AI_MODEL, AI_DAILY_TOKEN_BUDGET e limite de gasto na conta do provedor. 20 pode ser construído com adaptador falso; o smoke real fica pendente até a chave. 21 exige 11 e 17. |
| E. Qualidade | 23, 24, 25 | Não. Dependem de A–D concluídas. |
| F. Publicação | 26 → 27 → 28 | Sim: acesso à Vercel, URL/domínio final e duas contas reais para o aceite. |

Regras:

- A ordem respeita todos os `blocked_by` do manifesto; conferir os bloqueadores continua obrigatório.
- A fase C pode ser antecipada assim que o SMTP estiver pronto, por exemplo para convidar a equipe mais cedo. Até lá, novos membros só entram por procedimento administrativo no terminal, como o do ticket 02 (o script atual cria apenas administradores), nunca por endpoint público.
- A fase D pode começar antes da chave real, com adaptador falso apenas em testes; o recurso fica desativado para a equipe até 22 concluir.
- Suítes de integração (`test:rls`, `test:e2e:auth`) rodam no terminal do usuário, com a chave secreta só no ambiente, ao fim de cada ticket com banco ou interface autenticada.


## Ordem e entregas

1. **[Abrir a SPA responsiva com rotas e estados de configuração](issues/01-abrir-a-spa-responsiva-com-rotas-e-estados-de-configuracao.md)**
   - Bloqueado por: nenhum.
   - Entrega: Abrir o app em computador ou celular, navegar por URLs e identificar quando falta configuração sem mostrar telas quebradas.

2. **[Entrar com Supabase Auth e reconhecer a equipe](issues/02-entrar-com-supabase-auth-e-reconhecer-a-equipe.md)**
   - Bloqueado por: 01.
   - Entrega: Uma conta existente entra com e-mail/senha, vê sua equipe e sai; contas sem equipe não veem mapas.

3. **[Recuperar senha e concluir links de autenticação](issues/03-recuperar-senha-e-concluir-links-de-autenticacao.md)**
   - Bloqueado por: 02.
   - Entrega: A pessoa recupera acesso ou define senha a partir de um link válido no computador e no celular.

4. **[Convidar uma pessoa para entrar na equipe](issues/04-convidar-uma-pessoa-para-entrar-na-equipe.md)**
   - Bloqueado por: 03.
   - Entrega: Administrador envia convite e a pessoa passa a integrar a equipe ao concluir o acesso.

5. **[Criar um mapa com responsável e reabri-lo](issues/05-criar-um-mapa-com-responsavel-e-reabri-lo.md)**
   - Bloqueado por: 02.
   - Entrega: Qualquer membro cria um mapa, vê a raiz no editor e reabre o conteúdo salvo.

6. **[Criar e editar nós com autoria e salvamento](issues/06-criar-e-editar-nos-com-autoria-e-salvamento.md)**
   - Bloqueado por: 05.
   - Entrega: Adicionar filhos e editar texto mostra resposta imediata, salva e mantém a autoria original.

7. **[Navegar pelo mapa com layout e gestos mobile](issues/07-navegar-pelo-mapa-com-layout-e-gestos-mobile.md)**
   - Bloqueado por: 06.
   - Entrega: Uma árvore com vários ramos se organiza sem sobreposição e pode ser explorada por mouse ou toque.

8. **[Recuperar rascunhos e resolver conflito sem perda](issues/08-recuperar-rascunhos-e-resolver-conflito-sem-perda.md)**
   - Bloqueado por: 06.
   - Entrega: Falha de rede, recarga ou edição de outra pessoa não apaga silenciosamente o trabalho local.

9. **[Excluir um ramo preservando a integridade do mapa](issues/09-excluir-um-ramo-preservando-a-integridade-do-mapa.md)**
   - Bloqueado por: 06.
   - Entrega: Um membro remove um nó e seus descendentes sem deixar conexões ou dados órfãos.

10. **[Desfazer e refazer alterações próprias](issues/10-desfazer-e-refazer-alteracoes-proprias.md)**
   - Bloqueado por: 09.
   - Entrega: Reverter criação, texto e exclusão durante a sessão recupera conteúdo e autoria corretos.

11. **[Mover ramos e ordenar irmãos por controles acessíveis](issues/11-mover-ramos-e-ordenar-irmaos-por-controles-acessiveis.md)**
   - Bloqueado por: 07, 10.
   - Entrega: Reorganizar um ramo pelo menu mantém filhos, autoria e capacidade de desfazer.

12. **[Recolher ramos e lembrar a visualização por pessoa](issues/12-recolher-ramos-e-lembrar-a-visualizacao-por-pessoa.md)**
   - Bloqueado por: 07.
   - Entrega: A pessoa concentra o mapa e retoma seu zoom/ramos recolhidos sem alterar a visualização dos colegas.

13. **[Organizar a biblioteca por projeto e responsável](issues/13-organizar-a-biblioteca-por-projeto-e-responsavel.md)**
   - Bloqueado por: 05.
   - Entrega: Encontrar mapas por título, projeto/cliente e responsável sem carregar todo o conteúdo.

14. **[Transferir responsabilidade sem restringir a edição](issues/14-transferir-responsabilidade-sem-restringir-a-edicao.md)**
   - Bloqueado por: 05.
   - Entrega: Responsável ou administrador transfere um mapa para outro membro ativo, mantendo autoria histórica.

15. **[Desativar acesso de membros preservando autoria](issues/15-desativar-acesso-de-membros-preservando-autoria.md)**
   - Bloqueado por: 04, 14.
   - Entrega: Administrador remove acesso de um membro sem apagar os mapas e nós que ele criou.

16. **[Duplicar mapas para explorar outra direção](issues/16-duplicar-mapas-para-explorar-outra-direcao.md)**
   - Bloqueado por: 08.
   - Entrega: Criar uma cópia independente de um mapa sem alterar o original.

17. **[Excluir mapas com responsável ou administrador](issues/17-excluir-mapas-com-responsavel-ou-administrador.md)**
   - Bloqueado por: 14.
   - Entrega: Remover um mapa da biblioteca com confirmação e impedir novas edições nele.

18. **[Exportar um backup portátil do mapa](issues/18-exportar-um-backup-portatil-do-mapa.md)**
   - Bloqueado por: 06.
   - Entrega: Baixar um arquivo que guarda estrutura e textos sem expor segredos ou outros mapas.

19. **[Importar backup como mapa novo e validado](issues/19-importar-backup-como-mapa-novo-e-validado.md)**
   - Bloqueado por: 18, 16.
   - Entrega: Reabrir um backup cria um mapa independente, e arquivos inválidos não alteram nada.

20. **[Gerar quatro filhos com IA e inseri-los diretamente](issues/20-gerar-quatro-filhos-com-ia-e-inseri-los-diretamente.md)**
   - Bloqueado por: 08, 10, 07.
   - Entrega: Selecionar um nó e pedir IA acrescenta quatro filhos reais, identificados pelo solicitante, com opção de desfazer.

21. **[Cancelar geração e tratar contexto alterado](issues/21-cancelar-geracao-e-tratar-contexto-alterado.md)**
   - Bloqueado por: 20, 11, 17.
   - Entrega: Cancelar, excluir ou modificar o contexto durante a geração tem resultado previsível e não insere nós no lugar errado.

22. **[Limitar uso de IA e expor falhas recuperáveis](issues/22-limitar-uso-de-ia-e-expor-falhas-recuperaveis.md)**
   - Bloqueado por: 21.
   - Entrega: A equipe usa IA dentro de limites definidos e entende quando deve aguardar ou corrigir configuração.

23. **[Completar navegação por teclado e acessibilidade mobile](issues/23-completar-navegacao-por-teclado-e-acessibilidade-mobile.md)**
   - Bloqueado por: 11, 12, 13, 19, 22.
   - Entrega: Todos os fluxos essenciais funcionam por teclado e toque, com foco e mensagens acessíveis.

24. **[Medir e otimizar edição de mapas com 200 e 500 nós](issues/24-medir-e-otimizar-edicao-de-mapas-com-200-e-500-nos.md)**
   - Bloqueado por: 12, 22.
   - Entrega: O editor permanece responsivo em mapas representativos e possui limites de desempenho medidos.

25. **[Verificar isolamento, autoria e integridade ponta a ponta](issues/25-verificar-isolamento-autoria-e-integridade-ponta-a-ponta.md)**
   - Bloqueado por: 15, 17, 19, 22.
   - Entrega: Provar que contas fora da equipe não acessam dados e que operações malformadas não corrompem mapas.

26. **[Preparar ambiente de publicação com Auth e banco reais](issues/26-preparar-ambiente-de-publicacao-com-auth-e-banco-reais.md)**
   - Bloqueado por: 04, 25.
   - Entrega: O mesmo projeto Supabase final é conferido/configurado para a URL publicada, preservando contas e dados existentes.

27. **[Publicar a SPA e validar links diretos](issues/27-publicar-a-spa-e-validar-links-diretos.md)**
   - Bloqueado por: 23, 24, 26.
   - Entrega: O app fica acessível por uma URL e abre mapas diretamente no desktop e no celular.

28. **[Validar a versão funcional e entregar operação à equipe](issues/28-validar-a-versao-funcional-e-entregar-operacao-a-equipe.md)**
   - Bloqueado por: 27.
   - Entrega: Confirmar que a equipe consegue executar o fluxo completo com IA real, desktop e mobile, e deixar instruções de uso e manutenção.

## Entregas maiores

- Primeira base navegável e autenticada: 01–03.
- Primeiro mapa salvo com edição: 05–08; equipe convidada pelo 04.
- Editor utilizável com histórico e organização: 09–19, respeitando bloqueadores.
- IA real com inserção direta e controles: 20–22.
- Acessibilidade, desempenho e isolamento: 23–25.
- Ambiente real, publicação e aceite funcional: 26–28.

Os intervalos organizam a leitura, não substituem o grafo. A sequência numérica é uma ordem de dependências válida, mas não considera entradas externas; para executar, seguir a "Sequência recomendada" acima.

## Documentos

- [Contrato técnico](CONTRATO-TECNICO.md): escolhas de implementação e comportamentos compartilhados.
- [Guia do executor](EXECUCAO.md): processo para modelo mais leve, evidências e tratamento de bloqueios.
- [Manifesto](manifest.json): IDs, estados e dependências legíveis por ferramenta.

## Decisões propostas que não exigem nova arquitetura

Login e-mail/senha via Supabase Auth, sem cadastro público; convites de administrador. React Router Data Mode. Uma equipe na interface inicial. Layout horizontal automático. IA inicial por adaptador OpenAI, com modelo configurável no servidor. Modelo exato, orçamento e ambientes são entradas externas listadas nos tickets que precisam delas. Nenhuma credencial real necessária para revisar os tickets.

Não há garantia de zero ajustes futuros no mobile: os fluxos já nascem responsivos e são testados por toque, reduzindo a necessidade de reestruturação posterior.

## Ambiente único confirmado

Usar o banco final desde o ticket 02. Não haverá Supabase local, staging nem segundo projeto de testes. O frontend continua rodando no computador quando necessário. Ver contrato seção 7 e docs/AUTH-SUPABASE.md para adaptação dos scripts e verificações não destrutivas.

## Pacote 2 — manutenção estrutural

Criado em 21/10/2026 a partir da análise estrutural pedida pelo usuário após a entrega do pacote 01–28. Na análise, typecheck, lint, 129 testes unitários e o audit passaram; nenhum bug funcional foi encontrado. Os riscos são de manutenção futura. O item "projeto fora do git" já foi resolvido (repositório público `euchicosousa/mapa`, por decisão do usuário). Estado: **draft**, divisão ainda não aprovada pelo usuário.

| # | Ticket | Bloqueado por | Por quê |
| --- | --- | --- | --- |
| 29 | [Padronizar a formatação do código](issues/29-padronizar-a-formatacao-do-codigo.md) | — | 160 linhas acima de 200 caracteres; Edge Functions quase minificadas. |
| 30 | [Consolidar as migrações em uma base](issues/30-consolidar-as-migracoes-em-uma-base.md) | — | 33 migrações; `apply_map_history` redefinida 10 vezes. |
| 31 | [Limitar o crescimento do registro de operações](issues/31-limitar-o-crescimento-do-registro-de-operacoes.md) | 30 | `map_operations` guarda snapshots e nunca é limpa. |
| 32 | [Decidir o escopo dos rascunhos offline](issues/32-decidir-o-escopo-dos-rascunhos-offline.md) | — | Decisão do usuário; define quanto o 33 pode simplificar. |
| 33 | [Simplificar o estado do editor](issues/33-simplificar-o-estado-do-editor.md) | 29, 32 | Cerca de 15 flags combinadas; guardas e mesclagem de resultado duplicadas. |
| 34 | [Dividir a tela do editor em componentes menores](issues/34-dividir-a-tela-do-editor.md) | 33 | `editor.tsx` com 584 linhas; recálculos a cada renderização. |
| 35 | [Migrar a autenticação para o fluxo PKCE](issues/35-migrar-a-autenticacao-para-pkce.md) | — | Tokens de sessão passam pela URL no fluxo `implicit`. |
| 36 | [Centralizar os limites do domínio](issues/36-centralizar-os-limites-do-dominio.md) | 30 | Limites duplicados entre cliente, Edge Functions e SQL. |
| 37 | [Ajustes menores de configuração e limpeza](issues/37-ajustes-menores-de-configuracao-e-limpeza.md) | — | Versão fixa, Vitest lento, cache de `public/`, artefatos na raiz. |

Ordem sugerida: 29 → 30 → 32 (decisão) → 33 → 34; 31, 35, 36 e 37 entram quando seus bloqueadores estiverem done. O 35 e o 31 precisam de entradas externas (templates de e-mail e decisão de retenção, respectivamente).
