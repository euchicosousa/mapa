# Preparação e publicação — tickets 26–27

Atualizado em 21/10/2026. Destino informado pelo usuário: **https://mapa.cnvt.com.br**. A SPA foi publicada no ticket 27. A preparação do ticket 26 está descrita abaixo; versão, verificações públicas e recuperação estão em [DEPLOY.md](DEPLOY.md).

## Recursos preparados

- Vercel: projeto `mapa`, equipe `agenciacnvt`, ID `prj_nMd42P6ei3MGiG56QZcf1vauwc5s`. Pasta vinculada em `.vercel` (ignorada). Framework Vite, Node 22.x, instalação `npm ci`, build `npm run build`, saída `dist`.
- Domínio associado e verificado pela Vercel em 21/10/2026 (`configured_correctly`, sem conflitos). DNS externo na HostGator (`dns3.hostgator.com.br` e `dns4.hostgator.com.br`), com **CNAME `mapa` → `95ec7b0356340172.vercel-dns-017.com`** criado pelo usuário. Evidência: `evidence/26/domain-verification.json`. Não substituir nameservers nem registros de outros serviços.
- Somente `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` foram enviados como variáveis de cliente do projeto Vercel (production/preview). Nenhuma chave administrativa/OpenAI foi enviada à Vercel. Previews não recebem automaticamente permissão de CORS ou callback; usar origens explícitas quando necessário.
- `.vercelignore` exclui arquivos `.env*`, execuções temporárias, evidências e saídas de testes. A vinculação da CLI acrescentou um token OIDC a `.env.local`, preservando as quatro configurações locais existentes; ele permanece privado e não entra no bundle. O teste de fronteira também cobre esse tipo de variável.

## Supabase existente

Projeto único `mapa`, ref `bodxafqkqlyfoyfgahyj`, região sa-east-1, PostgreSQL 17.11.0.003. Nenhum segundo banco, staging, reset ou seed. As 33 migrações já estavam aplicadas; não houve migração nesta entrega. Uma consulta agregada confirmou um administrador real ativo preexistente, sem alterar sua conta ou equipe.

O Auth passou a usar `https://mapa.cnvt.com.br` como Site URL e permite o callback **exato** `https://mapa.cnvt.com.br/auth/callback`. Os callbacks locais anteriores foram preservados. Não há wildcard de domínio/preview.

Correção encontrada nesta conferência: `/auth/v1/settings` retornava `disable_signup=false`, apesar da expectativa de cadastro fechado. O teste antigo considerava qualquer erro de signUp suficiente; isso podia aprovar um erro de endereço/entrega sem comprovar o bloqueio. Foi aplicado `[auth] enable_signup=false`, preservando o provedor de e-mail habilitado e sem usar `[auth.email] enable_signup=false`, que desligaria login por e-mail. O teste agora exige o código **`signup_disabled`**. Verificações posteriores confirmaram `disable_signup=true`, provedor de e-mail ativo e acesso anônimo desativado.

A configuração parcial revisável está em `scripts/auth-config/supabase/config.toml`. `config diff` foi inspecionado antes de cada push: primeiro somente cadastro; depois Site URL/callback. Quinze propriedades remotas não declaradas, incluindo SMTP, foram preservadas. Não enviar o config.toml completo de desenvolvimento ao projeto remoto.

SMTP preservado: Resend, remetente MAPA `<nao-responder@auth.cnvt.com.br>`, TLS porta 465. A entrega real para uma caixa autorizada e o consumo do link devem ser registrados separadamente; uma resposta de envio não comprova recebimento.

## Funções e segredos

Funções ativas: `generate-children` e `manage-invitation`, ambas com `verify_jwt=true`. Foram publicadas por `functions deploy --use-api`, sem Docker. O código CORS compartilhado usa os headers da versão fixada do SDK e permite somente origens exatas de `MAPA_ALLOWED_ORIGINS`. Origem nula, host parecido e origem não cadastrada recebem 403 sem permissão CORS. Requisições sem Origin continuam sujeitas a JWT e autorização, sem tratar CORS como controle de identidade.

Configuração não secreta:

- `MAPA_ALLOWED_ORIGINS`: `https://mapa.cnvt.com.br` e localhost/127.0.0.1 nas portas 5173, 4173, 4174 e 4175.
- `MAPA_AUTH_CALLBACK_URLS`: callback HTTPS oficial e os callbacks locais já autorizados no Auth.
- `AI_MODEL`: `gpt-6-luna`.
- `AI_DAILY_TOKEN_BUDGET`: 50.000 tokens/dia UTC/workspace, sem aumento.

A existência e os hashes de OPENAI_API_KEY, modelo e orçamento foram comparados em memória com os valores aprovados locais; coincidiram. Chaves permanecem no armazenamento de segredos do Supabase. Somente as duas listas de URLs foram acrescentadas. Não colocar segredos em variáveis `VITE_*`, JSON de configuração ou evidências.

As versões anteriores das funções foram preservadas em `evidence/26/original-*.json` para revisão/recuperação de código, sem valores de ambiente. Restaurar código exige manter JWT obrigatório e conferir novamente autorização/CORS; isso não reverte dados ou migrações.

## Backup e recuperação disponíveis

A consulta remota `supabase backups list --project-ref bodxafqkqlyfoyfgahyj` retornou `walg_enabled=true`, **`pitr_enabled=false` e nenhum backup listado**. Não há ponto de restauração confirmado nesta conferência e não se pode prometer PITR. Nenhum plano/add-on foi contratado.

Enquanto não houver backup confirmado do provedor, exportar os mapas importantes pelo backup portátil do app e guardar cópias fora do projeto. Importação cria uma cópia validada; esse JSON não recupera contas Auth, equipe, convites ou histórico completo.

Para um backup integral, um operador autorizado deve preparar uma exportação lógica nativa com `pg_dump`, conexão TLS e arquivos de serviço/senha com permissão 600, guardando o resultado cifrado fora do computador/projeto. Verificar a versão do cliente e os schemas a preservar (aplicação, Auth, migrações e funções) com os recursos/permissões do plano. Não incluir senha em argumentos, logs ou repositório. Não foi realizada exportação de dados reais nesta entrega.

Antes de qualquer restauração: escolher o ponto/arquivo validado, registrar o incidente, delimitar janela de manutenção e avaliar perda de alterações posteriores. Um restore integral pode sobrescrever dados e requer autorização específica; não faz parte destes testes. Nunca executar reset, truncamento, seed global ou rollback destrutivo de migrações para testar publicação.

A [documentação de backups](https://supabase.com/docs/guides/platform/backups) descreve disponibilidades por plano e distingue backup diário de PITR; o estado efetivamente observado acima prevalece sobre suposições.

## Verificações e pendências

- 128 testes unitários/componentes aprovados, incluindo quatro novos casos CORS; 11 casos focados de CORS/handler passaram.
- 46 testes RLS/integridade aprovados, incluindo o teste endurecido de cadastro desativado e negação a usuários sem equipe.
- `test:deployment-config`: três cenários contra Auth e funções publicadas, verificando preflight oficial/local, origem falsa negada, JWT obrigatório e disponibilidade sem iniciar geração de IA.
- Oito cenários de senha/convites com Auth real passaram em 1440×900 e 390×844. Validam consumo de link, recarga, senha e aceite; não comprovam, sozinhos, entrega a uma caixa de e-mail.
- Build/typecheck, lint e teste de fronteira do bundle aprovados. A inspeção dos oito arquivos compilados não encontrou os três valores secretos locais (chave administrativa, OpenAI e OIDC). No encerramento do ticket 26, a SPA ainda estava sem deploy.

Ticket 26 concluído: senha definida e salva pelo usuário, login e convite aceito confirmados no navegador; o servidor verificou exatamente um vínculo ativo de membro e um convite aceito. A conta e as equipes temporárias foram removidas por IDs exatos; o administrador real foi preservado. O recebimento em `and3rsonsousa@outlook.com` foi confirmado pelo usuário e observado no Outlook: mensagem MAPA, remetente esperado, 21/10/2026 às 08:41, na pasta Lixo Eletrônico. O link abriu o formulário de senha no frontend local autorizado, sem token restante na URL. A classificação como spam é uma limitação de entregabilidade observada, sem alteração automática das preferências da caixa. Abertura/refresh/login na URL pública serão conferidos após o deploy do ticket 27. Evidência sanitizada do fluxo assistido: `evidence/26/real-email.json`.
