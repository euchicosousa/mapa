# 32: Decidir o escopo dos rascunhos offline

**What to build:** Uma decisão registrada sobre quanto do mecanismo de rascunhos locais continua necessário, antes de refatorar o estado do editor.

**Blocked by:** nenhum.

**Status:** ready-for-agent — divisão aprovada pelo usuário em 21/10/2026.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Contexto

O mecanismo atual (`src/maps/drafts.ts`, `src/state/editor-lifecycle.ts` e boa parte de `src/state/editor.ts`) inclui: rascunho em IndexedDB por aba, epochs por conta e por mapa para impedir ressurreição após logout ou revogação, exportação de rascunho de emergência, diálogo de alterações pendentes ao sair e ao navegar, recuperação após falha de leitura do armazenamento e cópia da versão local em caso de conflito. Está testado e funciona, mas é a maior fonte de complexidade do editor: muitas das flags do store existem só para ele.

## Implementação definida

1. Levantar, com o usuário, os cenários reais da equipe: queda de rede durante a edição, fechar a aba com alterações pendentes, duas pessoas editando o mesmo mapa e uso no celular com conexão instável.
2. Apresentar três níveis possíveis, com o que cada um remove do código:
   - **Manter tudo:** nada muda.
   - **Intermediário:** manter fila e rascunho em IndexedDB e o diálogo ao sair; remover exportação de emergência, cópia da versão local em conflito (conflito passa a oferecer só "abrir a versão do servidor") e recuperação após falha de armazenamento.
   - **Mínimo:** sem IndexedDB; alterações pendentes só em memória, com aviso de `beforeunload` e conflito resolvido recarregando a versão do servidor.
3. Registrar a decisão no contrato técnico e atualizar o ticket 33 com o escopo escolhido.

## Critérios de aceite

- [ ] Decisão do usuário registrada no contrato técnico, com data.
- [ ] O ticket 33 descreve o que remover ou manter, de acordo com a decisão.

## Como verificar

Revisão do contrato e do ticket 33.

## Limites desta entrega

Nenhuma alteração de código.

## Dependências externas

Decisão do usuário.

## Registro do executor

Pendente.
