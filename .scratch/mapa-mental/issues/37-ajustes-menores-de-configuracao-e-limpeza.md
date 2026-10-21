# 37: Ajustes menores de configuração e limpeza

**What to build:** Um conjunto de correções pequenas de configuração e organização, cada uma independente das outras.

**Blocked by:** nenhum.

**Status:** in-progress — feito o que não depende de publicação; faltam o deploy (para conferir os headers) e a ativação do Secret scanning pelo usuário.

**Leitura obrigatória:** [contrato técnico](../CONTRATO-TECNICO.md), seções pertinentes ao domínio desta fatia, [guia do executor](../EXECUCAO.md) e a análise estrutural de 21/10/2026 que originou este pacote (resumida no [README](../README.md#pacote-2--manutenção-estrutural)). As decisões do contrato prevalecem sobre sugestões antigas do plano; instruções novas do usuário prevalecem sobre ambos.

## Implementação definida

1. **Versão do app:** `vite.config.ts` tem `0.1.0` fixo em `__APP_VERSION__`; passar a ler a versão do `package.json`.
2. **Testes mais rápidos:** o Vitest cria o jsdom 22 vezes (76% do tempo da suíte). Ajustar `pool` ou `isolate` em `vitest.config.ts`, mantendo o isolamento entre arquivos que os testes exigem.
3. **Cache dos arquivos de `public/`:** `vercel.json` aplica `no-store` a tudo fora de `/assets/`, inclusive `/brand/*.svg`. Dar cache curto (por exemplo um dia) aos arquivos estáticos e manter `no-store` só no `index.html`.
4. **Limpeza da raiz:** apagar `dist-smoke/` e os relatórios antigos do Playwright (já ignorados pelo git). Avaliar unir as seis configs do Playwright em uma, com `projects`.
5. **Proteção do repositório público:** ativar Secret scanning e Push protection no GitHub. É um passo do usuário, em Settings → Code security.

## Critérios de aceite

- [x] A versão exibida acompanha o `package.json`.
- [x] `npm test` passa com o mesmo número de testes e tempo total menor (registrar antes e depois).
- [ ] Os headers publicados conferem com a regra nova. *O teste dessa regra é `scripts/check-published.mjs` (`npm run test:published`), não `test:deployment-config`, que confere Auth e CORS.* Só pode ser conferido depois do deploy.
- [x] A raiz fica sem artefatos de build e de relatório. *Exceções intencionais:* `playwright-auth-report/` e `test-results/`, da execução do ticket 30, mantidos até o ticket 38 gerar novos; `dist/`, recriado a cada build.
- [ ] Secret scanning e Push protection ativos, confirmados pelo usuário.

## Como verificar

`npm test`, `npm run test:deployment-config`, `curl -I` no domínio publicado após o deploy.

## Limites desta entrega

Itens independentes; cada um pode virar um commit próprio.

## Dependências externas

Deploy na Vercel para conferir os headers; acesso do usuário às configurações do GitHub.

## Registro do executor

1. **Versão:** `vite.config.ts` importa `version` do `package.json`; o build gerou `0.1.0+2026-10-21T22:57:04.335Z`. O `scripts/check-published.mjs` deixou de procurar `0.1.0` fixo e aceita qualquer versão `x.y.z+data`.
2. **Vitest:** `pool: 'vmThreads'` em `vitest.config.ts`. Medição com cache quente (a primeira medição da análise, 17,7 s, era a execução a frio): `threads` (padrão) 2,25–2,56 s; `forks` 2,58–2,60 s; `vmThreads` 0,99–1,09 s em três execuções seguidas, sempre com 131/131. Cada arquivo continua num contexto de VM próprio.
3. **Cache de `public/`:** em `vercel.json`, a regra `no-store` passou a excluir `brand/`, e `/brand/(.*)` ganhou `public, max-age=86400`. O rewrite da SPA também passou a excluir `brand/`: um SVG inexistente responde 404, em vez de servir o HTML com um dia de cache. `scripts/check-published.mjs` confere os dois SVGs (200, `image/svg+xml`, cache de um dia, `nosniff`) e o 404. Documentado em `docs/DEPLOY.md`. **Não publicado:** a conferência real fica para depois do próximo deploy (`npm run test:published`).
4. **Limpeza:** `dist-smoke/`, `playwright-report/`, `playwright-accessibility-report/`, `test-results-accessibility/` e `test-results-performance/` foram para a Lixeira do macOS (`~/.Trash/mapa-artefatos-2026-10-21/`), e não apagados de vez, para poderem ser recuperados. Todos são recriados pelas suítes e já eram ignorados pelo git. As seis configs do Playwright continuam separadas: cada uma tem `baseURL`, `webServer`, `globalSetup` e pastas de saída próprias (dev na 4174, build sem configuração na 4173, performance na 4175, site publicado). Unir em `projects` obrigaria um comando a subir todos os servidores, sem ganho real.
5. **Secret scanning e Push protection:** passo do usuário no GitHub, em Settings → Code security. Pendente.

Verificações: typecheck, lint e `format:check` sem erros; `npm test` 131/131; `vite build` e `test:bundle` aprovados; `node --check scripts/check-published.mjs` ok; `vercel.json` validado como JSON.
