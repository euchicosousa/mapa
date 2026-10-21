# 18: Exportar um backup portátil do mapa

**What to build:** Baixar um arquivo que guarda estrutura e textos sem expor segredos ou outros mapas.

**Blocked by:** 06: Criar e editar nós com autoria e salvamento

**Status:** done — implementado e verificado em 20 de outubro de 2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e resultados dos bloqueadores. As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. Definir formato JSON version 1: format=mapa-mental, version=1, exportedAt, map.title e nodes [{id,parentId,text,sortOrder}]. Autoria opcional em campo provenance claramente informativo; sem workspace ids, tokens ou dados Auth.
2. Exportar snapshot consistente do documento local e indicar se contém alterações pendentes. Validar árvore antes de gerar; máximo do contrato.
3. Botão funciona desktop/mobile por download nativo disponível; nome de arquivo sanitizado.
4. Documentar formato e fornecer fixture pequena para importador posterior.

## Critérios de aceite

- [x] Arquivo possui uma raiz e todos os pais resolvem; texto Unicode preservado.
- [x] Backup inclui edição local pendente com indicação visível.
- [x] Conteúdo não inclui token, segredo, outro mapa ou e-mail privado.
- [x] Exportação não altera revisão do mapa.
- [x] Fluxo desta fatia verificado em 390×844 e 1440×900 quando houver interface.
- [x] Verificações executadas e resultado registrado; ausência de infraestrutura registrada como bloqueio, sem marcar done.

## Como verificar

Validar JSON/fixture e estrutura com testes; E2E download e conteúdo nos dois viewports.

## Limites desta entrega

Sem PNG/PDF/Markdown nesta entrega; formato técnico de emergência continua separado até migrado.

## Dependências externas

Ambiente de desenvolvimento do frontend e, quando houver integração, acesso ao projeto Supabase final conforme a seção 7 do contrato. Sem Docker ou banco de staging.

## Registro do executor

Execução em 20/10/2026. Implementação do backup portátil v1 em `src/maps/backup.ts`, interface em `src/routes/map-export.tsx` e botão próprio no editor, disponível também com alterações pendentes. Não usa a fila técnica como formato de backup e não altera o fluxo de emergência.

- Captura síncrona e independente do documento local (metadados projetados, todos os nós e texto em edição); a checagem posterior de acesso não troca a fotografia pelo documento remoto. `hasPendingChanges` aparece na tela e no JSON. Ramos recolhidos permanecem no arquivo. O estado local, fila e histórico não são limpos pela exportação.
- Validação estrita: format/version/data/marcador de pendência, título até 120, texto até 500 caracteres Unicode, IDs únicos, uma raiz, pais resolvidos, conectividade/ciclos, profundidade 30, até 500 nós e arquivo até 2 MiB. Sem truncamento; nome de arquivo sanitizado, com data UTC e sem caminhos/identificadores internos.
- Projeção explícita de campos exclui Auth, equipes, mapas, autores, projetos, preferências, operações e dados de outros mapas. Proveniência opcional foi omitida. Antes do download nativo, consulta real de acesso ao mapa no Primary pelo RPC já existente; falha/revogação/exclusão impedem exportação. Guards impedem arquivo tardio após troca de tela/conta/mapa. Não há nova migração, alteração de Auth/RLS/RPC nem escrita no banco pelo recurso.
- Formato e limites documentados em [docs/BACKUP.md](../../../docs/BACKUP.md); fixture pequena `tests/fixtures/mapa-backup-v1.json`, validada pelo schema compartilhado para o importador posterior (19 ainda não iniciado).
- Verificações iniciais concluídas: typecheck, lint, 76 testes unitários em 12 arquivos (12 novos do formato), build e fronteira pública do bundle. Teste real novo no Primary: 6/6 E2E em 1440×900 e 390×844, com checagem adicional em 360 px, download de JSON salvo/pendente, Unicode, ramos recolhidos, ausência de dados privados/outro mapa, revisão inalterada, texto inválido sem download, falha de rede, saída durante verificação e revogação. Execução `20261020-83d16b` removida integralmente. Regressão de duplicação/exclusão e rascunho de emergência: 12/12, execução `20261020-f894be` limpa. Capturas de desktop/mobile revisadas.
- Não houve configuração externa ausente nem integração simulada. Testes de falha controlam rede/armazenamento apenas no navegador de validação; acessos e documentos usam o Primary real. Sem deploy, PNG/PDF/Markdown ou importação nesta fatia. Avisos anteriores de build (PURE do Zod e chunk principal >500 kB) mantidos para o ticket 24; Chromium com viewports emulados não equivale a testar dispositivos físicos.


- **Conferência final:** as mesmas 18 migrações locais/remotas; nenhum usuário ou registro de validação restante. Contagens finais: 1 workspace/vínculo/perfil/mapa, 2 nós/operações, 0 projetos/preferências. [Resultados e comandos](../evidence/18/resultados.json), logs, backups de teste e capturas em `evidence/18`. Ticket/manifesto done. Total 15/28 concluídos, 13 restantes; próximo recomendado 19, não iniciado.
