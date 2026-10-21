# Plano do app de mapas mentais

Atualizado em 19 de outubro de 2026. Planejamento; implementação não iniciada.

O detalhamento executável está no [pacote de 28 tickets](.scratch/mapa-mental/README.md). O [contrato técnico](.scratch/mapa-mental/CONTRATO-TECNICO.md) consolida as decisões posteriores deste planejamento; use-o como referência de implementação. A divisão foi aprovada pelo usuário. O ticket 01, já implementado funcionalmente, foi reaberto para ajuste Swiss Design; respeitar os estados e dependências do manifesto.

## 1. Produto e decisões confirmadas

Um app para “abrir caminhos”: partir de uma ideia, pergunta ou desafio e explorar possibilidades em ramos. Usos principais: ideias e projetos próprios, conteúdos e estratégias de clientes. Público: o usuário e sua equipe, editando em momentos diferentes.

- Cada membro da equipe pode criar e editar mapas compartilhados.
- Cada mapa tem um responsável, inicialmente quem o criou. Responsabilidade não limita a edição aos demais membros.
- Cada nó identifica a pessoa que o criou. Edições posteriores não mudam essa autoria.
- Cada nó oferece criação manual de filhos e expansão por IA.
- Os nós gerados pela IA entram diretamente no mapa, sem revisão ou aceite prévios. A pessoa mantém, edita ou remove depois; pode desfazer o lote inteiro.
- Supabase é obrigatório para banco de dados e autenticação.
- Rapidez de interação é prioridade. SPA para navegador, com desktop e mobile utilizáveis desde a primeira versão. Ações por toque, painéis responsivos e teclado virtual fazem parte de cada entrega.

## Direção visual

Swiss Design desde o ticket 01: grid editorial, tipografia sem serifa, hierarquia forte, alinhamentos precisos, respiro e cantos retos na interface. Usar #fafafa e #121212 como extremos de uma escala neutra, com cinzas intermediários para superfícies, bordas e texto secundário. Os nós podem ter formato de pílula; a definição final e sua personalização ficam para depois. Cores semânticas em tons neutros e cores escolhidas para os mapas são futuras; não entram nesta etapa. Detalhes executáveis e verificação mobile estão no contrato técnico.

## 2. Experiência

Entrar → biblioteca da equipe → abrir ou criar mapa → escrever ideia central → criar filhos manualmente ou gerar com IA → aprofundar, reorganizar e recolher ramos → salvar automaticamente → retomar depois.

A biblioteca mostra título, cliente/projeto, responsável e última edição, com filtros simples. O editor oferece área ampla, título, responsável, estado do salvamento, zoom, enquadramento e desfazer/refazer. A autoria aparece nos detalhes do nó; nos gerados, indicar “Gerado com IA por [pessoa]”.

Cada nó tem um único pai, exceto a raiz. Relações livres entre ramos ficam para depois. O responsável pode ser transferido para outro membro ativo; proposta inicial: transferência pelo responsável atual ou administrador.

## 3. Escopo inicial do editor

- Login com Supabase Auth, perfis e membros de equipe. Padrão proposto para execução: e-mail/senha, recuperação de senha e acesso por convite, sem cadastro público.
- Criar, listar, abrir, renomear, duplicar e excluir mapas, com confirmação para exclusão de mapa com conteúdo.
- Organização opcional por cliente ou projeto.
- Criar, editar e excluir nós; reorganizar ordem e pai preservando descendentes.
- Impedir ciclos e exclusão isolada da raiz.
- Recolher ramos, zoom, navegação e organização automática.
- Ações por botões e teclado. Tab cria filho; Enter cria irmão quando fora da edição de texto. Atalhos não podem interferir indevidamente na digitação.
- Desfazer/refazer na sessão, inclusive exclusão de ramos e geração por IA.
- Salvamento remoto automático, recuperação de falhas e proteção contra sobrescrita de versões antigas.
- Exportar/importar backup com validação. Importação cria uma cópia sem alterar mapas existentes.

Dados importados não podem forjar autoria: novos registros pertencem à pessoa que importa, preservando referências anteriores apenas como metadados não confiáveis. Duplicação registra quem criou a cópia e pode manter uma referência à origem.

## 4. Expansão com IA

1. Selecionar um nó e escolher “Gerar caminhos com IA”.
2. Opcionalmente informar uma orientação; não exigir formulário.
3. Gerar quatro filhos em um nível, com textos de até 120 caracteres.
4. Assim que a resposta for validada tecnicamente, inserir os filhos diretamente, destacando o lote novo sem deslocar inesperadamente a visualização.
5. Mostrar “Caminhos adicionados” com ação “Desfazer”. Cada nó também pode ser editado, removido ou expandido novamente.

Não existe etapa de aceite. Validação técnica significa conferir formato, limites, permissões e contexto, sem avaliação humana prévia.

Contexto enviado: título do mapa, caminho da raiz até o nó, filhos já existentes e orientação opcional. Briefing de cliente pode ser incorporado futuramente de forma explícita. Não enviar automaticamente outros mapas. Propor hipóteses quando faltarem fatos sobre o cliente.

A geração ocorre por Supabase Edge Function, que verifica usuário e acesso ao mapa e chama o provedor de IA com credenciais no servidor. O servidor aplica a resposta em uma transação autenticada de finalização do job e registra o lote para desfazer. O editor reconcilia o resultado preservando alterações locais. A gravação é atômica e idempotente; o cliente não pode forjar origem IA.

Registrar a pessoa que solicitou como criadora dos nós, com origem `ai` e identificador do lote. Isso distingue autoria humana direta de geração assistida, mantendo a responsabilidade identificável.

Estados e exceções:

- Mostrar geração em andamento sem bloquear outras partes do editor.
- Permitir cancelar; respostas canceladas ou repetidas não inserem nós.
- Falha de geração não altera o mapa; permitir nova tentativa.
- Se o nó/contexto relevante mudar ou for removido, não aplicar uma resposta desatualizada silenciosamente; avisar e oferecer nova geração.
- Conflito de revisão impede sobrescrita e preserva o resultado local para recuperação.
- Desfazer o lote preserva nós anteriores. Mudanças posteriores seguem a ordem normal do histórico.
- Enquanto o salvamento não for confirmado, indicar alterações pendentes.

A IA está prevista no produto desde o protótipo, podendo ser integrada após o editor básico. Demonstrações devem ser identificadas; a versão sem integração não deve fingir geração real.

## 5. Stack proposta

| Camada | Escolha | Papel |
| --- | --- | --- |
| Aplicação | React + TypeScript + Vite, como SPA | Interface interativa no navegador e build estático |
| Rotas | React Router em Data Mode | URLs próprias, navegação, layouts e tratamento de rotas |
| Editor visual | React Flow (`@xyflow/react`) | Nós personalizados, conexões, seleção e navegação |
| Estado do editor | Zustand | Estado local, ações e histórico de desfazer/refazer |
| Dados remotos | TanStack Query + supabase-js | Carregamento, cache e sincronização com o serviço |
| Interface | Tailwind CSS + Radix Dialog | Controles consistentes, sem efeitos caros no canvas |
| Login e banco | Supabase Auth + PostgreSQL | Identidade, equipe, mapas e nós |
| Geração por IA | Supabase Edge Functions | Chamada autenticada ao provedor e proteção das credenciais |
| Publicação | Vercel, proposta | Hospedagem dos arquivos da SPA com fallback de rotas |

A SPA é adequada ao editor autenticado, mas não garante desempenho sozinha. React Flow cuida da interação visual; d3-hierarchy calcula a árvore horizontal, com alturas medidas e controles por toque. Não acrescentar um servidor separado inicialmente. Proposta de implementação: adaptador OpenAI Responses; modelo e orçamento definidos por configuração segura antes do smoke real.

### Rotas da SPA

Usar React Router em Data Mode, com createBrowserRouter e RouterProvider. TanStack Query permanece responsável pelo cache remoto; loaders podem aproveitar esse cache sem criar uma segunda fonte de dados.

- `/login`: entrada na conta.
- `/auth/callback`: retorno do fluxo de autenticação quando necessário.
- `/mapas`: biblioteca da equipe.
- `/mapas/:mapId`: editor de um mapa específico.
- `/equipe`: membros e convites, com ações administrativas restritas.
- Rota desconhecida: página de não encontrado.

Layout autenticado aguarda a verificação da sessão antes de mostrar conteúdo privado, preservando o destino interno para retorno após login. Isso melhora a navegação; a autorização real continua no Supabase/RLS. Um identificador de mapa na URL não concede acesso.

Carregar o editor sob demanda. Proteger navegação interna e saída com alterações ainda não salvas; recuperação local continua necessária, pois avisos de fechamento não são garantidos. Configurar a hospedagem para servir a SPA em URLs internas sem interferir em arquivos estáticos. Validar link direto, recarregamento, voltar/avançar e sessão expirada.

## 6. Dados e permissões

Esquema conceitual, ainda sem migrações:

| Tabela | Campos principais |
| --- | --- |
| profiles | id vinculado ao Auth, nome, avatar, estado do perfil |
| workspaces | id, nome |
| workspace_members | workspace_id, user_id, papel, estado |
| projects | id, workspace_id, nome, identificação opcional do cliente |
| maps | id, workspace_id, project_id opcional, título, owner_id, created_by, updated_by, revision, datas |
| nodes | id, map_id, parent_id, texto, ordem, created_by, updated_by, source (`manual`/`ai`), ai_generation_id opcional, datas |
| ai_generations | id, map_id, parent_node_id, requested_by, estado, identificador da operação, modelo e metadados de uso |

Nós em registros separados permitem autoria, integridade e alterações por nó. Conexões derivam de parent_id; preferências de visualização e ramos recolhidos ficam separadas do conteúdo, por usuário/mapa.

Garantias do banco:

- RLS em todas as tabelas expostas. Login sozinho não concede acesso: validar vínculo ativo com a equipe do mapa.
- Membros podem criar e editar mapas e nós da equipe; responsável não é o único editor.
- created_by vem da identidade autenticada e é imutável. updated_by registra o último editor separadamente. A interface não pode forjar autoria ou marcação de geração.
- Responsável deve pertencer à equipe; transferências e gerenciamento de membros possuem regras próprias.
- parent_id precisa apontar para nó do mesmo mapa; impedir ciclos e múltiplas raízes.
- Revisão do mapa e alterações dos nós são verificadas e gravadas numa única transação, por operação de banco autenticada.
- Indexar consultas por equipe, projeto, mapa, pai e vínculo de membro, conforme consultas reais.
- Preservar autoria histórica de membros desativados. Tratar remoção de responsável com transferência, evitando exclusão em cascata do trabalho.
- Chave publicável no cliente; segredos administrativos e da IA somente no servidor.

Os membros trabalham por turnos. Se duas sessões se sobrepuserem, uma versão antiga não sobrescreve a nova: manter alterações locais e oferecer salvar uma cópia antes de carregar a versão atual. Uma atualização de dados em segundo plano também não substitui edições locais pendentes.

## 7. Desempenho

- Digitar, selecionar e mover atualiza o estado local imediatamente, sem esperar o banco.
- Agrupar salvamentos após uma pausa curta, proposta de 500–800 ms, com fila, revisão e recuperação. “Salvo” somente após confirmação.
- Atualizar nós afetados; evitar redesenhar o mapa inteiro a cada tecla. Componentes e seletores com dependências restritas.
- Layout automático só quando a estrutura ou dimensões relevantes mudarem; avaliar worker se o cálculo bloquear a interface.
- Ramos recolhidos não mantêm descendentes renderizados. Carregar editor sob demanda e paginar a biblioteca.
- Cache remoto não deve disputar o estado ativo do editor.
- Persistência local de alterações pendentes com separação por conta e limpeza adequada ao sair.
- Sem colaboração em tempo real nesta etapa. Latência da IA é tratada como tarefa assíncrona e não trava a edição.

Metas propostas, a validar em aparelho e navegador registrados: resposta visual local abaixo de 100 ms no percentil 95; zoom e movimento próximos de 60 fps em um mapa de 200 nós simples. Testar também 500 nós para descobrir limites antes de prometer suporte. SPA e bibliotecas não representam garantia dessas metas.

## 8. Entregas

1. Base responsiva e login Supabase reais, com convites e recuperação.
2. Fatias completas de mapas e edição, incluindo persistência, autorização e autoria em cada recurso.
3. Editor com histórico, organização, recuperação, backup e mobile.
4. IA real com inserção direta, cancelamento, proteção contra duplicação e limites.
5. Validação de acesso, desempenho, publicação e aceite funcional pela equipe.

A ordem detalhada e os bloqueadores estão no pacote de tickets. Não existe uma etapa horizontal de banco adiada para depois de toda a interface.

Sem prazo definido. Versões de dependências serão fixadas na implementação e mantidas no arquivo de lock.

## 9. Critérios de sucesso

- Criar 10 nós em até 3 minutos após orientação breve.
- Outro membro abre e edita o mapa sem precisar ser o responsável.
- Todo mapa tem responsável e todo nó tem criador identificável; editar não muda o criador.
- Gerar por IA insere diretamente; remover um nó e desfazer um lote funcionam.
- Recarregar recupera alterações confirmadas como salvas.
- Falhas e conflitos não provocam perda silenciosa ou duplicação.
- Usuário fora da equipe não lê nem modifica dados por acesso direto.
- Exportar/importar preserva estrutura e conteúdo sem falsificar autoria.
- Cumprir metas de interação em testes, medindo separadamente tempo de geração da IA.

## 10. Futuras melhorias e decisões restantes

Depois da base: cores, notas longas, anexos, busca, exportação visual, modelos opcionais, briefings de clientes e marcação de caminhos promissores. Edição simultânea, acesso de clientes e aplicativo nativo ficam fora do escopo inicial.

Decisões para execução: nome provisório Mapa, Swiss Design com escala neutra entre #fafafa e #121212, com cinzas intermediários nesta etapa, login e-mail/senha via Supabase; responsável ou administrador transfere/exclui mapa e todos os membros editam conteúdo. IA via adaptador OpenAI; modelo, orçamento e acessos dos ambientes são entradas externas das etapas de integração/publicação. O contrato técnico detalha limites, schema, regras de concorrência, UX mobile e estados de erro.

## Referências técnicas

- Vite: https://vite.dev/guide/
- React Flow, mapa mental: https://reactflow.dev/learn/tutorials/mind-map-app-with-react-flow
- React Flow, desempenho: https://reactflow.dev/learn/advanced-use/performance
- Supabase com React: https://supabase.com/docs/guides/getting-started/tutorials/with-react
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- TanStack Query: https://tanstack.com/query/latest/docs/framework/react/overview

- React Router Data Mode: https://reactrouter.com/start/data/installation

## Ambiente Supabase — decisão posterior do usuário

Usar desde o ticket 02 um único projeto Supabase final para Auth, banco e funções. Não haverá staging, banco local ou segundo projeto de testes; Docker não é necessário. Frontend local e publicado conectam ao mesmo backend. Manter migrações versionadas e verificar permissões com recursos delimitados no próprio projeto, sem reset, seeds de senhas conhecidas ou alteração de dados reais da equipe. Ticket 02 foi liberado para adaptar ferramentas e verificar integração; configuração do projeto é entrada externa.
