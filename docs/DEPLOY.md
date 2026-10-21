# Publicação e recuperação do frontend

Destino: **https://mapa.cnvt.com.br**, projeto Vercel `mapa`, equipe `agenciacnvt`. O projeto Supabase final continua sendo `bodxafqkqlyfoyfgahyj`. A publicação do frontend não cria banco nem executa migrações.

## Publicar

Requisitos: CLI Vercel autenticada, projeto vinculado em `.vercel`, dependências do lockfile e somente `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` nas variáveis Production da Vercel. As chaves OpenAI e administrativas, modelo e limites ficam no Supabase, conforme [PUBLICACAO.md](PUBLICACAO.md).

1. Executar `npm test`, `npm run build`, `npm run lint` e `npm run test:bundle`.
2. Revisar `vercel deploy --dry --json --scope agenciacnvt`. `.env*`, `.validation-runs`, `.scratch`, relatórios e imagens locais não devem ser enviados.
3. Publicar com `vercel deploy --prod --yes --scope agenciacnvt`.
4. Executar `npm run test:published`. Esse comando inspeciona os arquivos públicos e usa contas/espaços temporários no Supabase final, registrados e limpos por IDs exatos. Não usa contas reais da equipe para mudanças de senha ou convites. Precisa da configuração administrativa local privada já utilizada pelos testes de integração; nunca enviá-la à Vercel.
5. Registrar ID/URL imutável do deploy, versão de build, hashes dos assets e resultado do smoke. Evidências desta entrega ficam em `.scratch/mapa-mental/evidence/27/`.

`vercel.json` aplica fallback ao HTML nas rotas da SPA, preserva assets e retorna 404 para assets inexistentes. Uma página desconhecida exibe o 404 do aplicativo após o carregamento; a resposta do shell SPA é HTTP 200. HTML/rotas usam `no-store`; arquivos com hash em `/assets/` usam um ano de cache com `immutable`. Não publicar arquivos sem hash nessa pasta.

HTTPS, `nosniff`, bloqueio de frame, política sem referer e câmera/microfone/geolocalização desabilitados foram conferidos nas respostas publicadas. A URL oficial e o callback exato `/auth/callback` já estão permitidos no Supabase; um novo domínio exige revisão explícita das listas Auth/CORS, sem wildcard de preview.

## Registro de falhas

O cliente captura erros globais, rejeições não tratadas e erros da rota em memória (até 20 registros) e no console do navegador. Cada registro contém somente categoria fixa, rota normalizada, versão de build e horário. `/mapas/:id` remove identificadores; caminhos desconhecidos viram `/404`; query, hash, mensagens, stacks, dados de mapas, e-mail e tokens não entram nesse registro. O teste de privacidade usa erros com conteúdo sensível sintético e verifica a exclusão.

Não há coleta centralizada, serviço pago ou envio desses eventos a terceiros. Esse registro é efêmero, não substitui monitoramento de campo e desaparece ao recarregar a página. Para investigar um relato, usar a versão de build e a categoria fixa do console; não pedir que a pessoa compartilhe tokens, dados de sessão, corpo de requisições ou textos de mapas. As respostas HTTP do deploy ficam nos recursos de observabilidade já disponíveis na Vercel; falhas do servidor ficam no Supabase.

## Recuperar uma versão

Registrar um deploy aprovado antes da próxima publicação. Para restaurar o frontend, selecionar seu ID ou URL imutável e conferir a compatibilidade com as migrações atuais; depois executar `vercel rollback <id-ou-url-aprovado> --scope agenciacnvt --yes`. Conferir o alias oficial e repetir `npm run test:published`. A CLI instalada teve a assinatura de rollback verificada; nenhum rollback foi executado neste ticket.

Referência publicada: `dpl_2qdMEvn4UEELuRscohiVBnqcFCJz`, URL imutável `https://mapa-4w1e095s2-agenciacnvt.vercel.app`, build `0.1.0+2026-10-21T11:59:12.983Z`.

Esta é a primeira publicação. O primeiro deploy de validação apresentou uma disputa entre navegação de histórico e saída da conta; ele foi substituído e não é referência de recuperação. O deploy final aprovado deve ser usado como referência para versões futuras. Não há versão anterior comprovadamente estável para restaurar antes dessa referência.

Rollback do frontend não restaura banco, dados, migrações, funções Edge, Auth ou segredos. Neste ticket não houve migração; o frontend exige as mesmas 33 migrações já verificadas no ticket 26. Nunca executar reset, seed ou rollback destrutivo do banco para acompanhar uma troca de frontend. Limitações de backup estão registradas em PUBLICACAO.md.

## Fontes consultadas

- [Vite na Vercel — links diretos](https://vercel.com/docs/frameworks/frontend/vite).
- [Cache-Control na Vercel](https://vercel.com/docs/caching/cache-control-headers).
- [Redirects Auth no Supabase](https://supabase.com/docs/guides/auth/redirect-urls).

## Validação de 21/10/2026

129 testes unitários/componentes, build/typecheck, lint e fronteira do bundle aprovados. A rodada pública final passou 10/10 em desktop e mobile emulado, incluindo edição persistida com duas contas, histórico/recarga, convites, callbacks e senha. Sete rotas e quatro assets conferidos: nenhum dos três segredos locais nem marcadores de fixtures publicados; backend final e função real de IA identificados. Nenhuma migração ou chamada cobrada de IA. Recursos temporários removidos por IDs; consulta agregada confirmou zero remanescentes e preservação do administrador real.

Foi corrigida uma disputa entre navegação de histórico e logout: o botão Sair aguarda a navegação. Uma rodada posterior teve demora transitória no login pós-convite; duas repetições isoladas e a rodada completa final passaram. Causa dessa intermitência não estabelecida. Evidências originais e sanitizadas preservadas; não confundir emulação móvel com teste de hardware físico nem links administrativos com nova confirmação de entrega SMTP.
