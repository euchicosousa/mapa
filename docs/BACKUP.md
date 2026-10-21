# Backup portátil — versão 1

No editor, use **Exportar backup → Baixar backup JSON** no computador ou celular. O navegador recebe um arquivo `.json`; o destino depende das opções de download do dispositivo. Não há PNG, PDF ou Markdown nesta versão.

O arquivo é uma fotografia do documento local no momento do pedido de download: título, todos os nós (inclusive ramos recolhidos), texto em edição e operações locais já projetadas. Antes de baixar, o app confirma novamente o acesso ao mapa pelo Supabase. A resposta dessa consulta não substitui a fotografia local. Falha de conexão, acesso revogado ou mapa excluído impedem o download. Sair da tela durante a verificação impede um download tardio.

A tela avisa quando há alterações pendentes. O arquivo também registra `hasPendingChanges: true`; isso não confirma salvamento no servidor nem resolve conflitos. O salvamento automático normal continua funcionando independentemente da exportação. Exportar não envia comandos de escrita, não muda a revisão nem limpa a fila/histórico. Um título ainda digitado no formulário de detalhes só faz parte do documento depois de usar **Salvar título**; o texto do nó que está sendo editado já faz parte do rascunho local.

## Estrutura

```json
{
  "format": "mapa-mental",
  "version": 1,
  "exportedAt": "2026-10-20T12:00:00.000Z",
  "hasPendingChanges": false,
  "map": { "title": "Meu mapa" },
  "nodes": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "parentId": null,
      "text": "Ideia central",
      "sortOrder": 0
    }
  ]
}
```

- `format` e `version` identificam este contrato. A versão 1 exige exatamente os campos documentados; campos desconhecidos são rejeitados pelo schema compartilhado.
- `exportedAt`: data/hora UTC do snapshot em ISO 8601. `hasPendingChanges`: estado local pendente no momento da captura, mesmo que o salvamento termine enquanto o acesso é conferido.
- `map` contém somente `title`, entre 1 e 120 caracteres Unicode, não vazio ou composto só de espaços.
- Cada nó tem apenas `id`, `parentId`, `text` e `sortOrder`. IDs UUID únicos relacionam nós dentro do arquivo; não autorizam operações no servidor. O importador cria IDs novos e remapeia pais; os identificadores do arquivo não selecionam registros existentes.
- Exatamente uma raiz (`parentId: null`); todos os outros pais devem existir no arquivo. Árvore conectada, sem ciclos, até 500 nós e profundidade 30 (raiz no nível zero).
- `text`: 1–500 caracteres Unicode, sem ficar em branco; preserva acentos, emojis, quebras de linha e texto literal, inclusive sinais de HTML. `sortOrder`: inteiro não negativo até 2147483647. Não há truncamento silencioso.
- Limite serializado: 2 MiB (2 × 1024 × 1024 bytes), compatível com o limite do importador. JSON é UTF-8. O nome usa `mapa-<título sanitizado>-AAAA-MM-DD.json`, com prefixo fixo e título de até 64 caracteres; separadores de caminho e caracteres reservados são removidos/substituídos. O título dentro do JSON é preservado integralmente.

O formato não leva IDs de equipe, mapa, responsável ou autor, projetos, e-mails de perfis, tokens, credenciais, fila técnica, logs, preferências pessoais ou dados de outros mapas. Proveniência é opcional na especificação geral; esta versão do exportador a omite por completo. Textos inseridos pelas pessoas são preservados como conteúdo, inclusive se a pessoa escreveu um e-mail dentro de um nó.

O schema e o gerador ficam em `src/maps/backup.ts`. A fixture pequena, com Unicode e três nós, está em `tests/fixtures/mapa-backup-v1.json` e é validada pelos testes. A importação usa esse mesmo schema antes do envio; o servidor valida novamente cada campo e a árvore inteira.

## Importar um backup

Na biblioteca, use **Importar backup**, selecione o arquivo e confira o título e a quantidade de nós antes de **Confirmar importação**. Após a confirmação do servidor, o app abre a URL do novo mapa. A interface atual foi preservada; foram adicionados somente os controles funcionais da importação.

A leitura verifica o limite de 2 MiB antes de abrir o arquivo, exige JSON UTF-8 válido e tem limite de espera de 10 segundos. Formato/versão desconhecidos, arquivo de emergência, campos extras, duas raízes, pai ausente, ciclos, texto inválido, IDs repetidos e limites de nós/profundidade são rejeitados. Não há editor de migração nem importação de HTML ou de outros formatos.

Textos, relações, título e ordem dos irmãos são preservados. Os índices sortOrder são normalizados para 0, 1, 2… por pai, com desempate pelo UUID antigo; valores altos ou espaçados do arquivo não impedem novas adições de nós. Todo mapa importado começa salvo na revisão 1, sem projeto, com histórico e preferências vazios, sob responsabilidade de quem importou; created_by/updated_by dos novos registros são dessa pessoa e source=manual. Todos os UUIDs são novos. Se o backup continha alterações locais pendentes, seus textos são importados como conteúdo do novo mapa, sem sincronizar ou modificar a origem.

O arquivo não escolhe equipe, responsável ou autoria. A API deriva a equipe do vínculo ativo da sessão (esta interface exige exatamente um), revalida o acesso também no replay e repete a validação de estrutura/tamanho/textos antes de inserir. O servidor cria mapa, nós e operação em uma transação, pela mesma primitiva privada usada em duplicação e recuperação local. A recuperação mantém seu contrato anterior: depende de origem autorizada, normaliza ordens e não importa autoria/projeto. A importação mantém a ordem dos irmãos, normalizando seus índices e não depende da existência da origem. Nenhuma escrita direta nas tabelas foi concedida ao cliente.

Falha na resposta mantém a biblioteca e o arquivo selecionado para repetir a mesma operação. A aba guarda somente ID da operação e SHA-256 do conteúdo canônico, separados por conta/equipe, sem guardar o backup no navegador. Após recarregar, selecione o mesmo arquivo para confirmar o pedido anterior. Outro arquivo representa uma nova importação; **Escolher outro arquivo** permite trocar a seleção após uma tentativa. Fechar/apagar os dados da aba elimina essa possibilidade de retomada. Sem conseguir registrar os identificadores, a solicitação não é enviada. O cliente limita a espera da chamada a 20 segundos; o servidor mantém idempotência caso uma resposta se perca.

Migrações `20261020145943_import_portable_backup.sql` e `20261020150900_normalize_import_order.sql`, no Primary final: `import_map_backup` pública invoker e implementação privada com autorização explícita/search_path vazio; validação compartilhada e primitiva de cópia inacessíveis diretamente a authenticated/anon. Proveniência externa não é aceita neste formato estrito e nunca concede identidade ou autorização. A origem de um arquivo portátil não vira referência autorizativa.

## Distinção do arquivo de emergência

`mapa-emergency-draft` continua sendo um formato técnico separado, usado para recuperar o estado da sessão em falhas/conflitos e após exclusão quando autorizado. Ele pode conter identificadores internos e operações pendentes. Não deve ser confundido com `mapa-mental` nem aceito pelo futuro importador portátil. O ticket 18 não migra nem altera esse fluxo.

## Verificação

Testes unitários cobrem fixture, projeção segura de campos, snapshot imutável, Unicode, nomes de arquivo, schema, IDs/pais/raiz/ciclos, limites de profundidade/nós e tamanho serializado. Testes reais no Primary verificam download nos dois tamanhos, ramos recolhidos, edição pendente, texto inválido, revisão inalterada e ausência de outro mapa/perfis/credenciais, além de falha de acesso/conexão e saída da tela durante verificação. Capturas e resultados ficam em `.scratch/mapa-mental/evidence/18`.
