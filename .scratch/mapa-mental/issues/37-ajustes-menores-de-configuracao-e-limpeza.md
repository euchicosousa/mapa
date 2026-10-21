# 37: Ajustes menores de configuração e limpeza

**What to build:** Um conjunto de correções pequenas de configuração e organização, cada uma independente das outras.

**Blocked by:** nenhum.

**Status:** draft

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. **Versão do app:** `vite.config.ts` tem `0.1.0` fixo em `__APP_VERSION__`; passar a ler a versão do `package.json`.
2. **Testes mais rápidos:** o Vitest cria o jsdom 22 vezes (76% do tempo da suíte). Ajustar `pool` ou `isolate` em `vitest.config.ts`, mantendo o isolamento entre arquivos que os testes exigem.
3. **Cache dos arquivos de `public/`:** `vercel.json` aplica `no-store` a tudo fora de `/assets/`, inclusive `/brand/*.svg`. Dar cache curto (por exemplo um dia) aos arquivos estáticos e manter `no-store` só no `index.html`.
4. **Limpeza da raiz:** apagar `dist-smoke/` e os relatórios antigos do Playwright (já ignorados pelo git). Avaliar unir as seis configs do Playwright em uma, com `projects`.
5. **Proteção do repositório público:** ativar Secret scanning e Push protection no GitHub. É um passo do usuário, em Settings → Code security.

## Critérios de aceite

- [ ] A versão exibida acompanha o `package.json`.
- [ ] `npm test` passa com o mesmo número de testes e tempo total menor (registrar antes e depois).
- [ ] Os headers publicados conferem com a regra nova (`npm run test:deployment-config` atualizado).
- [ ] A raiz fica sem artefatos de build e de relatório.
- [ ] Secret scanning e Push protection ativos, confirmados pelo usuário.

## Como verificar

`npm test`, `npm run test:deployment-config`, `curl -I` no domínio publicado após o deploy.

## Limites desta entrega

Itens independentes; cada um pode virar um commit próprio.

## Dependências externas

Deploy na Vercel para conferir os headers; acesso do usuário às configurações do GitHub.

## Registro do executor

Pendente.
