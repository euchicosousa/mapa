# Mapa

SPA de mapas mentais da equipe, em pt-BR e com Swiss Design monocromático. **Tickets 01–28 concluídos**, incluindo publicação e aceite do fluxo completo com IA real, desktop e mobile emulado. A versão funcional oferece equipe, biblioteca, edição e reorganização de ramos, rascunhos, histórico, responsabilidade por mapa, backup portátil e geração direta de quatro filhos com IA. Projeto Supabase final `mapa` (`bodxafqkqlyfoyfgahyj`). Sem Docker, Supabase local ou staging. Nenhuma integração foi substituída por simulação.

Disponível em **https://mapa.cnvt.com.br**. Comece pelo [guia de uso](docs/GUIA-DE-USO.md); manutenção em [operação](docs/OPERACAO.md) e resultados/limitações no [relatório de entrega](docs/ENTREGA.md). A próxima etapa é a avaliação pessoal do usuário; novas funcionalidades e mudanças de visual ficam para depois, conforme solicitado.

A geração de IA usa OpenAI real e está liberada para membros ativos, com limite aprovado de 50.000 tokens/dia UTC por workspace, uma geração ativa por usuário, 10/minuto/usuário e 100/dia/workspace. Configuração, jobs, falhas, limites e reconciliação estão em [docs/IA.md](docs/IA.md).

## Executar

Teclado, foco, adaptação móvel e limites da amostra com VoiceOver estão em [docs/ACESSIBILIDADE.md](docs/ACESSIBILIDADE.md). Execute `npm run test:a11y` para repetir a auditoria.

Isolamento, permissões, testes de integridade e avisos residuais dos advisors estão em [docs/SEGURANCA.md](docs/SEGURANCA.md). `npm run test:security` executa a matriz com contas descartáveis e JWTs reais.

Desempenho, amostras antes/depois e limites da emulação móvel estão em [docs/DESEMPENHO.md](docs/DESEMPENHO.md). `npm run test:performance` repete a medição no build de produção.

Runtime verificado: Node v22.17.0 / npm 10.9.2, versões compatíveis definidas em engines e .nvmrc.

```sh
npm ci
npm run dev
```

Abra a URL local exibida pelo Vite (normalmente http://localhost:5173/login). Para preview de produção local: `npm run build` e `npm run preview`.

Sem configuração Supabase, o shell informa o que falta e as rotas privadas levam ao login. Com configuração válida, o código de login por e-mail/senha chama o Supabase real; não existe cadastro público, sessão de demonstração ou mapa fictício. Biblioteca, criação de mapas, edição de nós e recuperação de senha usam os serviços reais.

## Navegar pelo mapa

Arraste o fundo com mouse ou um dedo para mover a visualização; no trackpad, deslize com dois dedos. Use pinça ou os botões +/− para aproximar e afastar. Enquadrar mostra a árvore inteira, reservando espaço para a barra de controles. A edição preserva o zoom; adicionar um filho move somente o necessário para alcançá-lo. O layout organiza os nós automaticamente; o painel permite mover ramos e ordenar irmãos.

No mobile, toque no nó e use o painel inferior para editar. O conteúdo do painel rola separadamente das ações, com espaço ajustado à viewport visual e às áreas seguras do dispositivo.

Nós folha podem ser excluídos pelo painel. Ao excluir um ramo com descendentes, confirme a quantidade antes de remover; a raiz do mapa é protegida. A autoria e o conteúdo removidos ficam registrados no servidor e podem ser restaurados pelo histórico da sessão.

Use **Desfazer** e **Refazer** para criação de nós, texto e exclusão. Com foco no canvas, Ctrl/Cmd+Z desfaz e Ctrl/Cmd+Shift+Z refaz; nos campos de texto, os atalhos continuam nativos. O histórico guarda até 100 ações próprias, nova edição limpa refazer e uma alteração de outra sessão invalida a pilha com explicação. Uma operação em voo é confirmada antes de sua inversão; pedidos sem resposta são preservados para repetição segura.

## Recuperar alterações

Rascunhos pendentes ficam no IndexedDB, separados por conta, equipe, mapa e sessão do editor. Após recarregar, a mesma conta precisa confirmar seu acesso antes de recuperá-los. Em conflito, escolha salvar sua versão como um mapa novo ou confirmar o descarte local para abrir a versão do servidor. Navegação e logout oferecem decisões explícitas para preservar trabalho.

Falha de armazenamento aparece na tela com tentativa de recuperação e exportação técnica de emergência. Não há modo offline completo: o acesso precisa ser confirmado no servidor. O JSON de emergência é distinto do backup portátil dos tickets 18–19. Fluxos, isolamento, resposta perdida e limites estão em [docs/RASCUNHOS.md](docs/RASCUNHOS.md).

Para reorganizar, selecione um nó e use **Mover** para buscar o novo pai; o ramo inteiro entra como último filho. **Subir/Descer** ordenam irmãos, com limites indicados. As três ações preservam autoria, seleção e zoom e podem ser desfeitas/refeitas. A raiz permanece fixa. O movimento funciona pelos controles no desktop e no celular.

Você pode **recolher/expandir ramos** pelo painel ou pelo controle lateral do nó. A quantidade de descendentes ocultos permanece visível. Zoom, posição e ramos recolhidos são preferências pessoais salvas no Supabase: cada colega retoma sua própria visualização. O indicador dessa gravação é separado do conteúdo; uma falha na visualização não impede editar o mapa.

## Organizar a biblioteca

Use **Projetos** para criar e renomear projetos da equipe. Em **Detalhes do mapa**, altere título e projeto com suporte a Desfazer/Refazer. Responsável atual ou administrador também pode transferir o mapa para outro membro ativo, preservando autoria e edição pela equipe. A exclusão exige confirmação e bloqueia novas edições; sessões antigas podem preservar rascunhos locais enquanto houver acesso à equipe. Busca por título, projeto/cliente e responsável ficam na URL; a biblioteca pagina 20 mapas, com tabela no desktop e cartões no mobile. Veja [o guia da biblioteca](docs/BIBLIOTECA.md).

Em **Detalhes do mapa → Duplicar mapa**, qualquer membro ativo cria uma cópia independente da última versão salva, no mesmo projeto e sob sua responsabilidade. A cópia abre em uma nova URL; falhas mantêm o original e permitem retomar a mesma solicitação depois de recarregar. Histórico e preferências começam vazios. A recuperação de rascunho local continua sendo um fluxo separado.

Em **Exportar backup → Baixar backup JSON**, baixe título, textos e estrutura do documento local, incluindo ramos recolhidos e alterações pendentes sinalizadas. A exportação confirma o acesso e não altera a revisão. Formato, limites e fixture em [docs/BACKUP.md](docs/BACKUP.md); o arquivo técnico de emergência continua separado. Na biblioteca, **Importar backup** valida esse JSON e cria um novo mapa independente com você como responsável.

## Marca MAPA

Criada a partir da composição da marca do site [CNVT](https://cnvt.com.br): **MA** acima de **PA**, letras geométricas pesadas em um bloco quase quadrado. SVG com paths, fundo transparente e sem dependência de fonte. Aplicado ao cabeçalho e favicon.

- [SVG principal](public/brand/mapa.svg), tinta #121212.
- [SVG inverso](public/brand/mapa-inverso.svg), papel #fafafa.
- [Notas de uso e referência](public/brand/README.md).

## Configuração real de Auth/equipe

Consulte [docs/AUTH-SUPABASE.md](docs/AUTH-SUPABASE.md) para conectar ao projeto final, rodar a validação Auth/RLS, gerar tipos remotos e provisionar o primeiro admin. Não executar seeds ou reset no projeto remoto.

Copie .env.example para .env.local e informe os dados públicos do projeto Supabase final. Campos públicos:

- `VITE_SUPABASE_URL`: URL raiz HTTPS do projeto; HTTP apenas em localhost/loopback.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: chave sb_publishable_… do projeto final.

Reinicie Vite após alterar configuração e refaça o build para preview. Validação de formato não comprova conectividade. Somente os campos públicos validados entram no bundle; outras variáveis VITE_* não são expostas automaticamente. Nunca colocar service_role, sb_secret_…, senha de banco ou OPENAI_API_KEY no frontend. Arquivos .env são privados e ignorados; seus valores não devem ser copiados para documentação ou bundle.

## Verificações

```sh
npm run typecheck
npm run lint
npm test
npm run test:bundle
npm run build
npx playwright install chromium
npm run test:e2e
```

O smoke usa dist na porta 4173, com configuração ausente, e encerra seu servidor ao terminar. Verifica desktop 1440×900 e mobile com toque em 390×844 e 360×800: rotas públicas, histórico, 404, ausência de overflow, foco, alvos de toque, marca SVG e bloqueio de rotas privadas. Não comprova Auth/RLS. Emulação Chromium não equivale a aparelho físico/Safari.

O smoke gera seu próprio build sem configuração em dist-smoke, mesmo quando .env.local existe. As suítes `test:rls` e `test:e2e:auth` rodam contra o projeto final com contas temporárias por execução; ver docs/AUTH-SUPABASE.md.

Relatório do smoke em playwright-report e capturas em test-results. Evidências anteriores do ticket 01 preservadas em .scratch/mapa-mental/evidence/01 (inclusive swiss/); evidências novas de marca e shell sem configuração em evidence/02.

## Organização

- src/app/router.tsx: Router Data Mode, rotas, loaders e actions; entrada redireciona conforme sessão/vínculo confirmados pelo serviço.
- src/auth: verificação de acesso, ações, sincronização com eventos Auth e limpeza de caches/estado na troca de identidade.
- src/lib/supabase.ts: SDK real, renovação/persistência de sessão; nenhuma chave de serviço.
- src/lib/config.ts e vite.config.ts: fronteira da configuração pública.
- src/routes/team.tsx: consulta da equipe e tela sem vínculo.
- src/routes/editor.tsx e src/maps/layout.ts: árvore horizontal com alturas medidas, pan, pinça, zoom e painel responsivo.
- src/app/query-client.ts: dados remotos; src/state/editor.ts: estado local do editor.
- src/styles.css: grid 12/4 colunas, tokens neutros, controles retos, campos de 16 px, alvos de 44 px, foco, safe areas e dvh.
- supabase: migrações versionadas; configuração/seed locais antigos não são usados no fluxo atual. Scripts administrativos e testes permanecem separados do bundle.

Não houve deploy nesta etapa. O banco final já contém as migrações de Auth, mapas e comandos de nós; o ticket 08 acrescenta a operação atômica de cópia em `20261019184928_recover_local_map.sql`. O [tracker](.scratch/mapa-mental/README.md) e o [contrato técnico](.scratch/mapa-mental/CONTRATO-TECNICO.md) definem a sequência e os aceites.

## Versões escolhidas

| Dependência | Versão |
| --- | --- |
| `@radix-ui/react-dialog` | 1.3.1 |
| `@supabase/supabase-js` | 2.118.0 |
| `@tailwindcss/vite` | 4.3.3 |
| `@tanstack/react-query` | 5.104.4 |
| `@xyflow/react` | 12.12.0 |
| `d3-hierarchy` | 3.1.2 |
| `react` | 19.3.1 |
| `react-dom` | 19.3.1 |
| `react-router` | 7.18.4 |
| `tailwindcss` | 4.3.3 |
| `zod` | 4.6.7 |
| `zustand` | 5.0.15 |
| `@eslint/js` | 10.0.1 |
| `@playwright/test` | 1.64.1 |
| `@testing-library/jest-dom` | 7.0.1 |
| `@testing-library/react` | 16.3.3 |
| `@types/d3-hierarchy` | 3.1.7 |
| `@types/node` | 22.20.5 |
| `@types/react` | 19.3.0 |
| `@types/react-dom` | 19.3.0 |
| `@vitejs/plugin-react` | 5.2.0 |
| `eslint` | 10.13.0 |
| `eslint-plugin-react-hooks` | 7.1.1 |
| `eslint-plugin-react-refresh` | 0.5.7 |
| `jsdom` | 29.1.1 |
| `typescript` | 5.9.3 |
| `typescript-eslint` | 8.71.2 |
| `vite` | 7.3.7 |
| `vitest` | 5.0.5 |

React Router 7 e Vite 7 são versões estáveis compatíveis com o runtime e as APIs escolhidas. Referências consultadas: [React Router Data Mode](https://reactrouter.com/7.18.4/start/data/installation), [Vite](https://vite.dev/guide/), [Tailwind com Vite](https://tailwindcss.com/docs/installation/using-vite), [chaves Supabase](https://supabase.com/docs/guides/getting-started/api-keys) e [changelog Supabase](https://supabase.com/changelog). Nenhuma mudança de banco/Auth foi feita nesta etapa.

CLI Supabase local: **2.121.0**, fixada em devDependencies.
